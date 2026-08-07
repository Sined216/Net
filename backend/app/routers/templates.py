from fastapi import APIRouter, Depends, HTTPException
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
        )


# ---------- Порты шаблона ----------
@router.post("/{template_id}/interfaces", response_model=schemas.InterfaceTemplateOut, status_code=201)
def add_template_interface(template_id: int, payload: schemas.InterfaceTemplateCreate,
                            db: Session = Depends(get_db), user: models.User = Depends(auth.can_edit)):
    template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    if db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.template_id == template_id, models.InterfaceTemplate.label == payload.label
    ).first():
        raise HTTPException(status_code=409, detail="В шаблоне уже есть порт с таким названием")

    iface = models.InterfaceTemplate(template_id=template_id, **payload.model_dump())
    db.add(iface)
    db.commit()
    db.refresh(iface)
    return iface


@router.delete("/{template_id}/interfaces/{iface_id}", status_code=204)
def delete_template_interface(template_id: int, iface_id: int, db: Session = Depends(get_db),
                               _: models.User = Depends(auth.can_edit)):
    iface = db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.id == iface_id, models.InterfaceTemplate.template_id == template_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Порт шаблона не найден")
    db.delete(iface)
    db.commit()
