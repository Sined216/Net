"""Импорт устройств из файла — через промежуточную таблицу.

Файл не заводит устройства сам. Строки ложатся в отдельную таблицу, а
человек переносит их в спецификацию по одной, глядя в обычное окно
устройства с подставленными данными. Так опечатка в файле не превращается
в сотню кривых записей, а неполная строка не мешает: чего не хватает,
дозаполняется руками при переносе.

Связи не импортируются намеренно: кабель — это пара портов, а портов у
устройства до его заведения ещё нет.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app import auth, importer, models, provisioning, schemas, serialize, sites
from app.routers import links
from app.audit import log_change
from app.database import get_db

router = APIRouter(prefix="/import", tags=["import"])

# Больше десяти тысяч строк за раз — это не «занесли спецификацию», а
# ошибка выгрузки; такой файл лучше отбить сразу.
MAX_ROWS = 10_000
MAX_BYTES = 16 * 1024 * 1024
# Кусками по мегабайту: лимит проверяется по ходу чтения, а не после того,
# как файл — каким бы огромным он ни был — уже целиком лёг в память.
_CHUNK_SIZE = 1024 * 1024


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Прочитать файл потоком, оборвав сразу на превышении лимита."""
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_CHUNK_SIZE):
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Файл больше 16 МБ — разделите его на части")
        chunks.append(chunk)
    return b"".join(chunks)


def _import_sync(filename: str, content: bytes, db: Session,
                  user: models.User, site_id: int) -> schemas.ImportSummary:
    """Разбор файла и запись строк — весь синхронный кусок работы разом.

    Остальные маршруты этого файла — обычные `def`, и FastAPI сам уводит их
    в пул потоков. Этот маршрут вынужден быть `async def` ради потокового
    чтения загружаемого файла (`UploadFile.read`) — но раз он `async def`,
    синхронная часть внутри него сама по себе в пул не попадёт и будет
    держать event loop, пока не отработает. Оборачивать в `run_in_threadpool`
    только `importer.parse()` было недостаточно: запись девяти с лишним
    тысяч строк и `commit()` — тоже синхронные и тоже блокировали event loop,
    просто уже после разбора. Здесь — целиком, одним вызовом.
    """
    try:
        parsed = importer.parse(filename, content)
    except importer.ImportError_ as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None

    if len(parsed) > MAX_ROWS:
        raise HTTPException(
            status_code=400,
            detail=f"В файле {len(parsed)} строк — больше {MAX_ROWS} за раз не принимаем",
        )

    for row in parsed:
        db.add(models.ImportRow(
            site_id=site_id,
            source_file=filename,
            row_number=row.row_number,
            extra=row.extra or None,
            imported_by=user.id,
            **{name: (value or None) for name, value in row.values.items()},
        ))

    log_change(db, user.id, "create", "import", None, old=None,
               new={"файл": filename, "строк": len(parsed)})
    db.commit()
    return schemas.ImportSummary(file=filename, added=len(parsed), skipped_empty=0)


@router.post("/devices", response_model=schemas.ImportSummary, status_code=201)
async def upload_devices(file: UploadFile = File(...), db: Session = Depends(get_db),
                          user: models.User = Depends(auth.can_edit),
                          site_id: int = Depends(sites.current_site_id)):
    """Прочитать файл и сложить строки в промежуточную таблицу."""
    content = await _read_limited(file, MAX_BYTES)
    filename = file.filename or "файл"
    return await run_in_threadpool(_import_sync, filename, content, db, user, site_id)


@router.get("/rows", response_model=list[schemas.ImportRowOut])
def list_rows(status: str | None = None, db: Session = Depends(get_db),
               site_id: int = Depends(sites.current_site_id)):
    """Строки импорта вместе с подсказками из справочников."""
    q = db.query(models.ImportRow).filter(models.ImportRow.site_id == site_id)
    if status:
        q = q.filter(models.ImportRow.status == status)
    rows = q.order_by(models.ImportRow.source_file, models.ImportRow.row_number).all()

    # Справочники читаются один раз на весь список, а не на каждую строку:
    # тысяча строк — тысяча лишних запросов.
    templates = {_key(t.name): t.id for t in db.query(models.DeviceTemplate).all()}
    groups = {
        _key(g.name): g.id
        for g in db.query(models.TopologyGroup).filter(models.TopologyGroup.site_id == site_id)
    }
    tags = {
        _key(t.name): t.id
        for t in db.query(models.Tag).filter(models.Tag.site_id == site_id)
    }

    # Уже заведённые названия, адреса и MAC — чтобы в таблице было видно, что
    # строка в спецификации уже есть. Тем же одним запросом на весь список.
    by_name: dict[str, int] = {}
    by_ip: dict[str, int] = {}
    by_mac: dict[str, int] = {}
    for device_id, name, ip, mac in db.query(
        models.Device.id, models.Device.name, models.Device.management_ip, models.Device.mac
    ).filter(models.Device.site_id == site_id):
        if name:
            by_name.setdefault(_key(name), device_id)
        if ip:
            by_ip.setdefault(_key(ip), device_id)
        if mac:
            by_mac.setdefault(_mac_key(mac), device_id)

    result = []
    for row in rows:
        out = schemas.ImportRowOut.model_validate(row)
        out.suggested_template_id = templates.get(_key(row.template_name))
        out.suggested_group_id = groups.get(_key(row.group_name))
        out.suggested_tag_ids = [
            tags[key] for key in (_key(part) for part in _split_tags(row.tags_text)) if key in tags
        ]
        out.same_name_device_id = by_name.get(_key(row.name)) if row.name else None
        out.same_ip_device_id = by_ip.get(_key(row.management_ip)) if row.management_ip else None
        out.same_mac_device_id = by_mac.get(_mac_key(row.mac)) if row.mac else None
        result.append(out)
    return result


@router.post("/rows/{row_id}/move", response_model=schemas.DeviceOut, status_code=201)
def move_row(row_id: int, payload: schemas.DeviceCreate, db: Session = Depends(get_db),
              user: models.User = Depends(auth.can_edit),
              site_id: int = Depends(sites.current_site_id)):
    """Перенести строку в спецификацию: завести устройство и пометить строку.

    Данные приходят из окна устройства, а не из строки: человек мог их
    поправить, и правда — то, что он видел на экране. Строка после переноса
    остаётся видна со ссылкой на заведённое устройство — чтобы было понятно,
    что из файла уже разобрано.
    """
    row = db.query(models.ImportRow).filter(
        models.ImportRow.id == row_id, models.ImportRow.site_id == site_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Строка импорта не найдена")
    if row.status == "moved":
        raise HTTPException(status_code=409, detail="Эта строка уже перенесена в спецификацию")

    template = db.query(models.DeviceTemplate).filter(
        models.DeviceTemplate.id == payload.template_id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    if payload.topology_group_id is not None and not db.query(models.TopologyGroup).filter(
        models.TopologyGroup.id == payload.topology_group_id,
        models.TopologyGroup.site_id == site_id,
    ).first():
        raise HTTPException(status_code=404, detail="Группа топологии не найдена")

    tags = []
    if payload.tag_ids:
        tags = db.query(models.Tag).filter(
            models.Tag.id.in_(payload.tag_ids), models.Tag.site_id == site_id,
        ).all()
        if len(tags) != len(set(payload.tag_ids)):
            raise HTTPException(status_code=404, detail="Один из тегов не найден")

    data = payload.model_dump(exclude={"template_id", "tag_ids"})
    device = provisioning.create_device(
        db, template=template, site_id=site_id, user_id=user.id, data=data, tags=tags,
    )

    row.status = "moved"
    row.device_id = device.id
    # Идентификатор устройства обязателен: история самой железки отбирается
    # по нему, и без него её появление в спецификации нигде не показывалось.
    origin = ({"из импорта": row.source_file, "строка": row.row_number}
              if row.source == "file" else {"из обхода": row.client_uuid or "—"})
    log_change(db, user.id, "create", "device", device.id, old=None,
               new={**origin, "site_id": site_id})
    db.commit()
    db.refresh(device)
    return serialize.serialize_device(device, db=db)


@router.delete("/rows/{row_id}", status_code=204)
def delete_row(row_id: int, db: Session = Depends(get_db), _: models.User = Depends(auth.can_edit),
                site_id: int = Depends(sites.current_site_id)):
    """Убрать строку из промежуточной таблицы. Заведённое по ней устройство
    остаётся: это уже спецификация, а не импорт."""
    row = db.query(models.ImportRow).filter(
        models.ImportRow.id == row_id, models.ImportRow.site_id == site_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Строка импорта не найдена")
    db.delete(row)
    db.commit()


@router.delete("/rows", status_code=204)
def clear_rows(status: str | None = None, db: Session = Depends(get_db),
                _: models.User = Depends(auth.can_edit),
                site_id: int = Depends(sites.current_site_id)):
    """Очистить промежуточную таблицу целиком или только разобранное."""
    q = db.query(models.ImportRow).filter(models.ImportRow.site_id == site_id)
    if status:
        q = q.filter(models.ImportRow.status == status)
    q.delete(synchronize_session=False)
    db.commit()


@router.get("/link-rows", response_model=list[schemas.ImportLinkRowOut])
def list_link_rows(status: str | None = None, db: Session = Depends(get_db),
                   site_id: int = Depends(sites.current_site_id)):
    """Связи из обхода вместе с попыткой опознать их концы.

    Строка приезжает текстом («свитч у окна», «порт 3») — здесь по этому
    тексту ищутся уже заведённые устройство и гнездо. Найденное только
    подставляется: решает человек при переносе.
    """
    q = db.query(models.ImportLinkRow).filter(models.ImportLinkRow.site_id == site_id)
    if status:
        q = q.filter(models.ImportLinkRow.status == status)
    rows = q.order_by(models.ImportLinkRow.id).all()
    if not rows:
        return []

    # Справочник устройств площадки — один раз на весь список, как и в
    # list_rows выше: сотня строк обхода не должна давать сотню запросов.
    devices = db.query(models.Device.id, models.Device.code, models.Device.name).filter(
        models.Device.site_id == site_id,
    ).all()
    by_code = {_key(code): (device_id, code) for device_id, code, _ in devices}
    by_name = {}
    for device_id, code, name in devices:
        if name:
            by_name.setdefault(_key(name), (device_id, code))

    interfaces = db.query(
        models.Interface.id, models.Interface.device_id,
        models.Interface.label, models.Interface.port_number,
    ).filter(models.Interface.site_id == site_id).all()
    ports_by_device: dict[int, list] = {}
    for iface_id, device_id, label, number in interfaces:
        ports_by_device.setdefault(device_id, []).append((iface_id, label, number))

    busy_ids = set()
    for a_id, b_id in db.query(models.Link.interface_a_id, models.Link.interface_b_id).filter(
        models.Link.site_id == site_id,
    ):
        busy_ids.update(x for x in (a_id, b_id) if x is not None)

    result = []
    for row in rows:
        out = schemas.ImportLinkRowOut.model_validate(row)
        for side in ("a", "b"):
            # Номер, принесённый телефоном, вернее любого угадывания по
            # тексту: телефон брал устройство из снимка, а не с чужих слов.
            known_id = getattr(row, f"{side}_device_id")
            device_text = getattr(row, f"{side}_device_text")
            found = None
            if known_id is not None:
                match = next((d for d in devices if d[0] == known_id), None)
                if match:
                    found = (match[0], match[1])
            if found is None and device_text:
                key = _key(device_text)
                found = by_code.get(key) or by_name.get(key)
            if not found:
                continue
            device_id, code = found
            setattr(out, f"suggested_{side}_device_id", device_id)
            setattr(out, f"suggested_{side}_device_code", code)

            iface = _match_port(ports_by_device.get(device_id, []), getattr(row, f"{side}_port_text"))
            if iface:
                setattr(out, f"suggested_{side}_interface_id", iface[0])
                setattr(out, f"suggested_{side}_interface_label", iface[1])
                setattr(out, f"{side}_interface_busy", iface[0] in busy_ids)
        result.append(out)
    return result


@router.post("/link-rows/{row_id}/move", response_model=schemas.LinkOut, status_code=201)
def move_link_row(row_id: int, payload: schemas.LinkCreate, db: Session = Depends(get_db),
                  user: models.User = Depends(auth.can_edit),
                  site_id: int = Depends(sites.current_site_id)):
    """Перенести строку обхода в спецификацию: завести связь и пометить строку.

    Как и у устройств, данные приходят из окна связи, а не из строки:
    человек мог поправить, и правда — то, что он видел на экране.
    """
    row = db.query(models.ImportLinkRow).filter(
        models.ImportLinkRow.id == row_id, models.ImportLinkRow.site_id == site_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Строка обхода не найдена")
    if row.status == "moved":
        raise HTTPException(status_code=409, detail="Эта строка уже перенесена в спецификацию")

    # Заведение связи — теми же проверками, что и обычное: чужая площадка,
    # занятое гнездо, блокировка портов на время записи. Дублировать их
    # здесь значило бы разойтись с ними при первой же правке.
    link_out = links.create_link(payload, db=db, user=user, site_id=site_id)

    row.status = "moved"
    row.link_id = link_out.id
    log_change(db, user.id, "create", "link", link_out.id, old=None,
               new={"из обхода": row.client_uuid or "—", "site_id": site_id})
    db.commit()
    return link_out


@router.delete("/link-rows/{row_id}", status_code=204)
def delete_link_row(row_id: int, db: Session = Depends(get_db),
                    _: models.User = Depends(auth.can_edit),
                    site_id: int = Depends(sites.current_site_id)):
    """Убрать строку обхода. Заведённая по ней связь остаётся: это уже
    спецификация."""
    row = db.query(models.ImportLinkRow).filter(
        models.ImportLinkRow.id == row_id, models.ImportLinkRow.site_id == site_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Строка обхода не найдена")
    db.delete(row)
    db.commit()


@router.delete("/link-rows", status_code=204)
def clear_link_rows(status: str | None = None, db: Session = Depends(get_db),
                    _: models.User = Depends(auth.can_edit),
                    site_id: int = Depends(sites.current_site_id)):
    """Очистить строки обхода целиком или только разобранные."""
    q = db.query(models.ImportLinkRow).filter(models.ImportLinkRow.site_id == site_id)
    if status:
        q = q.filter(models.ImportLinkRow.status == status)
    q.delete(synchronize_session=False)
    db.commit()


def _match_port(ports: list, text: str | None):
    """Найти гнездо по тому, как его записали в цеху.

    Сначала точное совпадение с подписью («Gi0/1»), потом — номер гнезда:
    в поле чаще пишут просто «3», чем полную подпись порта.
    """
    if not text:
        return None
    key = _key(text)
    for iface_id, label, _number in ports:
        if _key(label) == key:
            return (iface_id, label)
    digits = "".join(ch for ch in key if ch.isdigit())
    if digits:
        for iface_id, label, number in ports:
            if number == int(digits):
                return (iface_id, label)
    return None


def _key(value: str | None) -> str:
    """Сравниваем названия без регистра и лишних пробелов: в файле пишут
    «cisco 2960», в справочнике — «Cisco 2960»."""
    return " ".join((value or "").split()).lower()


# Разделители, которыми MAC пишут в разных выгрузках — та же оговорка, что
# и у поиска по MAC в /devices (см. routers/devices.py:_mac_like).
_MAC_SEPARATORS = ":-."


def _mac_key(value: str | None) -> str:
    """Сравниваем MAC без учёта разделителей и регистра: «A4-BB-6D» из файла
    и «a4:bb:6d…» в базе — один и тот же адрес."""
    cleaned = value or ""
    for sep in _MAC_SEPARATORS:
        cleaned = cleaned.replace(sep, "")
    return cleaned.lower()


def _split_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [part for part in (chunk.strip() for chunk in value.replace(";", ",").split(",")) if part]
