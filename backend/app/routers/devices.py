from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, schemas, auth
from app.audit import log_change

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[schemas.DeviceOut])
def list_devices(site_id: int | None = None, device_type_id: int | None = None,
                  db: Session = Depends(get_db)):
    q = db.query(models.Device).options(joinedload(models.Device.interfaces))
    if site_id is not None:
        q = q.filter(models.Device.site_id == site_id)
    if device_type_id is not None:
        q = q.filter(models.Device.device_type_id == device_type_id)
    return q.order_by(models.Device.code).all()


@router.get("/{device_id}", response_model=schemas.DeviceOut)
def get_device(device_id: int, db: Session = Depends(get_db)):
    device = (
        db.query(models.Device)
        .options(joinedload(models.Device.interfaces))
        .filter(models.Device.id == device_id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    return device


@router.post("", response_model=schemas.DeviceOut, status_code=201)
def create_device(payload: schemas.DeviceCreate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit)):
    if db.query(models.Device).filter(models.Device.code == payload.code).first():
        raise HTTPException(status_code=409, detail="Устройство с таким кодом уже существует")

    data = payload.model_dump(exclude={"interfaces"})
    device = models.Device(**data, created_by=user.id)
    db.add(device)
    db.flush()  # получить device.id

    for iface in (payload.interfaces or []):
        db.add(models.Interface(device_id=device.id, **iface.model_dump()))

    log_change(db, user.id, "create", "device", None, old=None, new=device)
    db.commit()
    db.refresh(device)
    return device


@router.patch("/{device_id}", response_model=schemas.DeviceOut)
def update_device(device_id: int, payload: schemas.DeviceUpdate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit)):
    device = db.query(models.Device).filter(models.Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")

    old_snapshot = {c.name: getattr(device, c.name) for c in device.__table__.columns}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(device, field, value)

    log_change(db, user.id, "update", "device", device.id, old=old_snapshot, new=device)
    db.commit()
    db.refresh(device)
    return device


@router.delete("/{device_id}", status_code=204)
def delete_device(device_id: int, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit)):
    device = db.query(models.Device).filter(models.Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    old_snapshot = {c.name: getattr(device, c.name) for c in device.__table__.columns}
    log_change(db, user.id, "delete", "device", device.id, old=old_snapshot, new=None)
    db.delete(device)
    db.commit()


# ---------- Интерфейсы конкретного устройства ----------
@router.get("/{device_id}/interfaces", response_model=list[schemas.InterfaceOut])
def list_interfaces(device_id: int, db: Session = Depends(get_db)):
    return db.query(models.Interface).filter(models.Interface.device_id == device_id).order_by(
        models.Interface.port_number, models.Interface.label
    ).all()


@router.post("/{device_id}/interfaces", response_model=schemas.InterfaceOut, status_code=201)
def add_interface(device_id: int, payload: schemas.InterfaceCreate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit)):
    device = db.query(models.Device).filter(models.Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    exists = db.query(models.Interface).filter(
        models.Interface.device_id == device_id, models.Interface.label == payload.label
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="У устройства уже есть интерфейс с таким названием")

    iface = models.Interface(device_id=device_id, **payload.model_dump())
    db.add(iface)
    log_change(db, user.id, "create", "interface", None, old=None, new=iface)
    db.commit()
    db.refresh(iface)
    return iface
