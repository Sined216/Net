from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth

router = APIRouter(tags=["catalog"])


@router.get("/device-types", response_model=list[schemas.DeviceTypeOut])
def list_device_types(db: Session = Depends(get_db)):
    return db.query(models.DeviceType).order_by(models.DeviceType.name).all()


@router.get("/vlans", response_model=list[schemas.VlanOut])
def list_vlans(site_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.Vlan)
    if site_id is not None:
        q = q.filter(models.Vlan.site_id == site_id)
    return q.order_by(models.Vlan.vlan_number).all()


@router.post("/vlans", response_model=schemas.VlanOut, status_code=201)
def create_vlan(payload: schemas.VlanCreate, db: Session = Depends(get_db),
                 _: models.User = Depends(auth.can_edit)):
    vlan = models.Vlan(**payload.model_dump())
    db.add(vlan)
    db.commit()
    db.refresh(vlan)
    return vlan


@router.delete("/vlans/{vlan_id}", status_code=204)
def delete_vlan(vlan_id: int, db: Session = Depends(get_db),
                 _: models.User = Depends(auth.can_edit)):
    vlan = db.query(models.Vlan).get(vlan_id)
    if not vlan:
        raise HTTPException(status_code=404, detail="VLAN не найден")
    db.delete(vlan)
    db.commit()
