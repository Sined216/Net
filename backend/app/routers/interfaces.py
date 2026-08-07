from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app import models, schemas, auth, serialize
from app.audit import log_change

router = APIRouter(tags=["interfaces"])


@router.patch("/interfaces/{interface_id}", response_model=schemas.InterfaceOut)
def update_interface(interface_id: int, payload: schemas.InterfaceUpdate, db: Session = Depends(get_db),
                      user: models.User = Depends(auth.can_edit)):
    iface = db.query(models.Interface).filter(models.Interface.id == interface_id).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")

    old_snapshot = {c.name: getattr(iface, c.name) for c in iface.__table__.columns}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(iface, field, value)

    log_change(db, user.id, "update", "interface", iface.id, old=old_snapshot, new=iface)
    db.commit()
    db.refresh(iface)
    link_map = serialize.build_link_map(db, [iface.id])
    return serialize.serialize_interface(iface, link_map)


@router.delete("/interfaces/{interface_id}", status_code=204)
def delete_interface(interface_id: int, db: Session = Depends(get_db),
                      user: models.User = Depends(auth.can_edit)):
    iface = db.query(models.Interface).filter(models.Interface.id == interface_id).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")
    old_snapshot = {c.name: getattr(iface, c.name) for c in iface.__table__.columns}
    log_change(db, user.id, "delete", "interface", iface.id, old=old_snapshot, new=None)
    db.delete(iface)
    db.commit()


@router.get("/search", response_model=list[schemas.SearchResult])
def search(query: str, db: Session = Depends(get_db)):
    """Найти по IP, MAC или имени/коду устройства."""
    like = f"%{query}%"
    rows = (
        db.query(models.Interface, models.Device)
        .join(models.Device, models.Device.id == models.Interface.device_id)
        .filter(
            or_(
                models.Interface.ip.ilike(like),
                models.Interface.mac.ilike(like),
                models.Device.name.ilike(like),
                models.Device.code.ilike(like),
            )
        )
        .limit(50)
        .all()
    )
    return [
        schemas.SearchResult(
            device_id=d.id, device_code=d.code, device_name=d.name,
            interface_id=i.id, interface_label=i.label, ip=i.ip, mac=i.mac,
        )
        for i, d in rows
    ]
