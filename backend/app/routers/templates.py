from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, schemas, auth
from app.audit import log_change

router = APIRouter(prefix="/device-templates", tags=["device-templates"])


@router.get("", response_model=list[schemas.DeviceTemplateOut])
def list_templates(device_type_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.DeviceTemplate).options(joinedload(models.DeviceTemplate.interfaces))
    if device_type_id is not None:
        q = q.filter(models.DeviceTemplate.device_type_id == device_type_id)
    return q.order_by(models.DeviceTemplate.name).all()


@router.get("/{template_id}", response_model=schemas.DeviceTemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db)):
    template = (
        db.query(models.DeviceTemplate)
        .options(joinedload(models.DeviceTemplate.interfaces))
        .filter(models.DeviceTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    return template


@router.post("", response_model=schemas.DeviceTemplateOut, status_code=201)
def create_template(payload: schemas.DeviceTemplateCreate, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit)):
    device_type = db.query(models.DeviceType).filter(models.DeviceType.id == payload.device_type_id).first()
    if not device_type:
        raise HTTPException(status_code=404, detail="Тип устройства не найден")

    data = payload.model_dump(exclude={"interfaces"})
    template = models.DeviceTemplate(**data)
    db.add(template)
    db.flush()  # получить template.id

    labels = set()
    for iface in payload.interfaces:
        if iface.label in labels:
            raise HTTPException(status_code=400, detail=f"Повторяющийся label порта в шаблоне: {iface.label}")
        labels.add(iface.label)
        db.add(models.InterfaceTemplate(template_id=template.id, **iface.model_dump()))

    log_change(db, user.id, "create", "device_template", None, old=None, new=template)
    db.commit()
    db.refresh(template)
    return template


@router.patch("/{template_id}", response_model=schemas.DeviceTemplateOut)
def update_template(template_id: int, payload: schemas.DeviceTemplateUpdate, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit)):
    template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")

    old_snapshot = {c.name: getattr(template, c.name) for c in template.__table__.columns}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    log_change(db, user.id, "update", "device_template", template.id, old=old_snapshot, new=template)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit)):
    template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    try:
        log_change(db, user.id, "delete", "device_template", template.id, old=None, new=None)
        db.delete(template)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="По этому шаблону уже заведены устройства в спецификации — сначала удалите их",
        ) from None


# ---------- Порты шаблона ----------
@router.post("/{template_id}/interfaces", response_model=schemas.InterfaceTemplateOut, status_code=201)
def add_template_interface(template_id: int, payload: schemas.InterfaceTemplateCreate,
                            db: Session = Depends(get_db), user: models.User = Depends(auth.can_edit)):
    """Добавить порт модели — и всем уже заведённым её экземплярам.

    Состав портов задаётся моделью, а не набивается у каждой железки
    отдельно: доукомплектовали модель — порт появляется у всех устройств
    этой модели. У кого порт с таким названием уже есть (завели руками на
    устройстве с изменяемым составом портов), тот пропускается.
    """
    template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    if db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.template_id == template_id, models.InterfaceTemplate.label == payload.label
    ).first():
        raise HTTPException(status_code=409, detail="В шаблоне уже есть порт с таким названием")

    iface = models.InterfaceTemplate(template_id=template_id, **payload.model_dump())
    db.add(iface)

    devices = db.query(models.Device).filter(models.Device.template_id == template_id).all()
    existing = {
        (row.device_id) for row in db.query(models.Interface).filter(
            models.Interface.device_id.in_([d.id for d in devices] or [0]),
            models.Interface.label == payload.label,
        ).all()
    }
    for device in devices:
        if device.id in existing:
            continue
        db.add(models.Interface(
            device_id=device.id, label=payload.label,
            port_number=payload.port_number, port_type=payload.port_type,
        ))

    log_change(db, user.id, "update", "device_template", template_id,
               old=None, new={"добавлен порт": payload.label, "устройств затронуто": len(devices) - len(existing)})
    db.commit()
    db.refresh(iface)
    return iface


@router.delete("/{template_id}/interfaces/{iface_id}", status_code=204)
def delete_template_interface(template_id: int, iface_id: int, db: Session = Depends(get_db),
                               user: models.User = Depends(auth.can_edit)):
    """Убрать порт из модели — и у всех её экземпляров.

    Связи при этом НЕ удаляются: кабель физически остаётся проложенным, у
    него просто повисает конец. Подключить его заново можно к другому порту
    (POST /links/{id}/attach).
    """
    iface = db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.id == iface_id, models.InterfaceTemplate.template_id == template_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Порт шаблона не найден")

    device_ids = [d.id for d in db.query(models.Device).filter(models.Device.template_id == template_id).all()]
    removed = 0
    if device_ids:
        doomed = [
            row.id for row in db.query(models.Interface).filter(
                models.Interface.device_id.in_(device_ids), models.Interface.label == iface.label,
            ).all()
        ]
        if doomed:
            # Связь между двумя портами одного и того же названия (два
            # одинаковых устройства воткнуты друг в друга) теряет сразу оба
            # конца — подвешивать нечего, такую удаляем целиком. Иначе
            # осталась бы запись без единого конца, и база её не примет.
            db.query(models.Link).filter(
                models.Link.interface_a_id.in_(doomed),
                models.Link.interface_b_id.in_(doomed),
            ).delete(synchronize_session=False)

            removed = db.query(models.Interface).filter(
                models.Interface.id.in_(doomed),
            ).delete(synchronize_session=False)

    log_change(db, user.id, "update", "device_template", template_id,
               old={"убран порт": iface.label, "устройств затронуто": removed}, new=None)
    db.delete(iface)
    db.commit()


@router.get("/{template_id}/impact", response_model=schemas.TemplateImpact)
def template_impact(template_id: int, db: Session = Depends(get_db)):
    """Сколько устройств и связей заденет правка портов этой модели.

    Нужно, чтобы интерфейс мог предупредить до нажатия, а не после:
    убранный порт оставляет подвешенные концы у всех экземпляров сразу.
    """
    device_ids = [d.id for d in db.query(models.Device).filter(models.Device.template_id == template_id).all()]
    if not device_ids:
        return schemas.TemplateImpact(devices=0, connected_ports=0)

    interface_ids = [
        i.id for i in db.query(models.Interface).filter(models.Interface.device_id.in_(device_ids)).all()
    ]
    connected = 0
    if interface_ids:
        connected = db.query(models.Link).filter(
            or_(
                models.Link.interface_a_id.in_(interface_ids),
                models.Link.interface_b_id.in_(interface_ids),
            )
        ).count()
    return schemas.TemplateImpact(devices=len(device_ids), connected_ports=connected)
