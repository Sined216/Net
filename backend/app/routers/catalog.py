from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth

router = APIRouter(tags=["catalog"])


@router.get("/device-types", response_model=list[schemas.DeviceTypeOut])
def list_device_types(db: Session = Depends(get_db)):
    return db.query(models.DeviceType).order_by(models.DeviceType.name).all()


@router.post("/device-types", response_model=schemas.DeviceTypeOut, status_code=201)
def create_device_type(payload: schemas.DeviceTypeCreate, db: Session = Depends(get_db),
                        _: models.User = Depends(auth.can_edit)):
    if db.query(models.DeviceType).filter(models.DeviceType.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Тип устройства с таким названием уже существует")
    if db.query(models.DeviceType).filter(models.DeviceType.code_prefix == payload.code_prefix).first():
        raise HTTPException(status_code=409, detail="Такой префикс кода уже используется другим типом")
    device_type = models.DeviceType(name=payload.name, code_prefix=payload.code_prefix.upper())
    db.add(device_type)
    db.commit()
    db.refresh(device_type)
    return device_type


@router.delete("/device-types/{type_id}", status_code=204)
def delete_device_type(type_id: int, db: Session = Depends(get_db),
                        _: models.User = Depends(auth.can_edit)):
    device_type = db.query(models.DeviceType).get(type_id)
    if not device_type:
        raise HTTPException(status_code=404, detail="Тип устройства не найден")
    try:
        db.delete(device_type)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Тип используется в шаблонах устройств — сначала удалите их")


@router.get("/vlans", response_model=list[schemas.VlanOut])
def list_vlans(db: Session = Depends(get_db)):
    return db.query(models.Vlan).order_by(models.Vlan.vlan_number).all()


@router.post("/vlans", response_model=schemas.VlanOut, status_code=201)
def create_vlan(payload: schemas.VlanCreate, db: Session = Depends(get_db),
                 _: models.User = Depends(auth.can_edit)):
    if db.query(models.Vlan).filter(models.Vlan.vlan_number == payload.vlan_number).first():
        raise HTTPException(status_code=409, detail="VLAN с таким номером уже существует")
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
