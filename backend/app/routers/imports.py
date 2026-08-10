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
from sqlalchemy.orm import Session

from app import auth, importer, models, provisioning, schemas, serialize, sites
from app.audit import log_change
from app.database import get_db

router = APIRouter(prefix="/import", tags=["import"])

# Больше десяти тысяч строк за раз — это не «занесли спецификацию», а
# ошибка выгрузки; такой файл лучше отбить сразу.
MAX_ROWS = 10_000
MAX_BYTES = 16 * 1024 * 1024


@router.post("/devices", response_model=schemas.ImportSummary, status_code=201)
async def upload_devices(file: UploadFile = File(...), db: Session = Depends(get_db),
                          user: models.User = Depends(auth.can_edit),
                          site_id: int = Depends(sites.current_site_id)):
    """Прочитать файл и сложить строки в промежуточную таблицу."""
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Файл больше 16 МБ — разделите его на части")

    try:
        parsed = importer.parse(file.filename or "файл", content)
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
            source_file=file.filename or "файл",
            row_number=row.row_number,
            extra=row.extra or None,
            imported_by=user.id,
            **{name: (value or None) for name, value in row.values.items()},
        ))

    log_change(db, user.id, "create", "import", None, old=None,
               new={"файл": file.filename, "строк": len(parsed)})
    db.commit()
    return schemas.ImportSummary(file=file.filename or "файл", added=len(parsed), skipped_empty=0)


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

    # Уже заведённые названия и адреса — чтобы в таблице было видно, что
    # строка в спецификации уже есть. Тем же одним запросом на весь список.
    by_name: dict[str, int] = {}
    by_ip: dict[str, int] = {}
    for device_id, name, ip in db.query(
        models.Device.id, models.Device.name, models.Device.management_ip
    ).filter(models.Device.site_id == site_id):
        if name:
            by_name.setdefault(_key(name), device_id)
        if ip:
            by_ip.setdefault(_key(ip), device_id)

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
    log_change(db, user.id, "create", "device", device.id, old=None,
               new={"из импорта": row.source_file, "строка": row.row_number, "site_id": site_id})
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


def _key(value: str | None) -> str:
    """Сравниваем названия без регистра и лишних пробелов: в файле пишут
    «cisco 2960», в справочнике — «Cisco 2960»."""
    return " ".join((value or "").split()).lower()


def _split_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [part for part in (chunk.strip() for chunk in value.replace(";", ",").split(",")) if part]
