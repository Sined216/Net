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

from app import auth, importer, models, schemas, serialize
from app.audit import log_change
from app.codegen import next_device_code
from app.database import get_db

router = APIRouter(prefix="/import", tags=["import"])

# Больше десяти тысяч строк за раз — это не «занесли спецификацию», а
# ошибка выгрузки; такой файл лучше отбить сразу.
MAX_ROWS = 10_000
MAX_BYTES = 16 * 1024 * 1024


@router.post("/devices", response_model=schemas.ImportSummary, status_code=201)
async def upload_devices(file: UploadFile = File(...), db: Session = Depends(get_db),
                          user: models.User = Depends(auth.can_edit)):
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
def list_rows(status: str | None = None, db: Session = Depends(get_db)):
    """Строки импорта вместе с подсказками из справочников."""
    q = db.query(models.ImportRow)
    if status:
        q = q.filter(models.ImportRow.status == status)
    rows = q.order_by(models.ImportRow.source_file, models.ImportRow.row_number).all()

    # Справочники читаются один раз на весь список, а не на каждую строку:
    # тысяча строк — тысяча лишних запросов.
    templates = {_key(t.name): t.id for t in db.query(models.DeviceTemplate).all()}
    groups = {_key(g.name): g.id for g in db.query(models.TopologyGroup).all()}
    tags = {_key(t.name): t.id for t in db.query(models.Tag).all()}

    result = []
    for row in rows:
        out = schemas.ImportRowOut.model_validate(row)
        out.suggested_template_id = templates.get(_key(row.template_name))
        out.suggested_group_id = groups.get(_key(row.group_name))
        out.suggested_tag_ids = [
            tags[key] for key in (_key(part) for part in _split_tags(row.tags_text)) if key in tags
        ]
        result.append(out)
    return result


@router.post("/rows/{row_id}/move", response_model=schemas.DeviceOut, status_code=201)
def move_row(row_id: int, payload: schemas.DeviceCreate, db: Session = Depends(get_db),
              user: models.User = Depends(auth.can_edit)):
    """Перенести строку в спецификацию: завести устройство и пометить строку.

    Данные приходят из окна устройства, а не из строки: человек мог их
    поправить, и правда — то, что он видел на экране. Строка после переноса
    остаётся видна со ссылкой на заведённое устройство — чтобы было понятно,
    что из файла уже разобрано.
    """
    row = db.query(models.ImportRow).filter(models.ImportRow.id == row_id).first()
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
        models.TopologyGroup.id == payload.topology_group_id
    ).first():
        raise HTTPException(status_code=404, detail="Группа топологии не найдена")

    tags = []
    if payload.tag_ids:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(payload.tag_ids)).all()
        if len(tags) != len(set(payload.tag_ids)):
            raise HTTPException(status_code=404, detail="Один из тегов не найден")

    data = payload.model_dump(exclude={"template_id", "tag_ids"})
    device = models.Device(
        template_id=template.id,
        code=next_device_code(db, template.device_type.code_prefix),
        created_by=user.id, tags=tags, **data,
    )
    db.add(device)
    db.flush()

    for tpl_iface in template.interfaces:
        db.add(models.Interface(
            device_id=device.id, port_number=tpl_iface.port_number,
            label=tpl_iface.label, connector_id=tpl_iface.connector_id,
            template_interface_id=tpl_iface.id,
        ))

    row.status = "moved"
    row.device_id = device.id
    log_change(db, user.id, "create", "device", None, old=None,
               new={"из импорта": row.source_file, "строка": row.row_number})
    db.commit()
    db.refresh(device)
    return serialize.serialize_device(device, db=db)


@router.delete("/rows/{row_id}", status_code=204)
def delete_row(row_id: int, db: Session = Depends(get_db), _: models.User = Depends(auth.can_edit)):
    """Убрать строку из промежуточной таблицы. Заведённое по ней устройство
    остаётся: это уже спецификация, а не импорт."""
    row = db.query(models.ImportRow).filter(models.ImportRow.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Строка импорта не найдена")
    db.delete(row)
    db.commit()


@router.delete("/rows", status_code=204)
def clear_rows(status: str | None = None, db: Session = Depends(get_db),
                _: models.User = Depends(auth.can_edit)):
    """Очистить промежуточную таблицу целиком или только разобранное."""
    q = db.query(models.ImportRow)
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
