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


@router.patch("/device-types/{type_id}", response_model=schemas.DeviceTypeOut)
def update_device_type(type_id: int, payload: schemas.DeviceTypeUpdate, db: Session = Depends(get_db),
                        _: models.User = Depends(auth.can_edit)):
    """Правка типа устройства.

    Смена префикса действует только на будущие устройства: код SW-0001
    напечатан на наклейке и лежит в чужих документах, поэтому задним числом
    коды не переписываются, а старый счётчик остаётся при своём префиксе.
    """
    device_type = db.get(models.DeviceType, type_id)
    if not device_type:
        raise HTTPException(status_code=404, detail="Тип устройства не найден")

    data = payload.model_dump(exclude_unset=True)
    if "code_prefix" in data:
        data["code_prefix"] = data["code_prefix"].upper()
    if "name" in data and db.query(models.DeviceType).filter(
        models.DeviceType.name == data["name"], models.DeviceType.id != type_id
    ).first():
        raise HTTPException(status_code=409, detail="Тип устройства с таким названием уже существует")
    if "code_prefix" in data and db.query(models.DeviceType).filter(
        models.DeviceType.code_prefix == data["code_prefix"], models.DeviceType.id != type_id
    ).first():
        raise HTTPException(status_code=409, detail="Такой префикс кода уже используется другим типом")

    for field, value in data.items():
        setattr(device_type, field, value)
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
        raise HTTPException(
            status_code=409, detail="Тип используется в шаблонах устройств — сначала удалите их"
        ) from None


# ---------- Разъёмы ----------
@router.get("/connector-types", response_model=list[schemas.ConnectorTypeOut])
def list_connector_types(db: Session = Depends(get_db)):
    return db.query(models.ConnectorType).order_by(models.ConnectorType.name).all()


@router.post("/connector-types", response_model=schemas.ConnectorTypeOut, status_code=201)
def create_connector_type(payload: schemas.ConnectorTypeCreate, db: Session = Depends(get_db),
                           _: models.User = Depends(auth.can_edit)):
    if db.query(models.ConnectorType).filter(models.ConnectorType.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Разъём с таким названием уже есть")
    connector = models.ConnectorType(**payload.model_dump())
    db.add(connector)
    db.commit()
    db.refresh(connector)
    return connector


@router.patch("/connector-types/{connector_id}", response_model=schemas.ConnectorTypeOut)
def update_connector_type(connector_id: int, payload: schemas.ConnectorTypeUpdate, db: Session = Depends(get_db),
                           _: models.User = Depends(auth.can_edit)):
    connector = db.get(models.ConnectorType, connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Разъём не найден")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and db.query(models.ConnectorType).filter(
        models.ConnectorType.name == data["name"], models.ConnectorType.id != connector_id
    ).first():
        raise HTTPException(status_code=409, detail="Разъём с таким названием уже есть")
    for field, value in data.items():
        setattr(connector, field, value)
    db.commit()
    db.refresh(connector)
    return connector


@router.delete("/connector-types/{connector_id}", status_code=204)
def delete_connector_type(connector_id: int, db: Session = Depends(get_db),
                           _: models.User = Depends(auth.can_edit)):
    """Удалить разъём из справочника.

    Если он уже проставлен портам, удаление отбивается: молча обнулить
    разъём у сотни портов — потерять данные, о которых никто не просил.
    """
    connector = db.get(models.ConnectorType, connector_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Разъём не найден")

    used_by_templates = db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.connector_id == connector_id
    ).count()
    used_by_interfaces = db.query(models.Interface).filter(
        models.Interface.connector_id == connector_id
    ).count()
    used_by_modules = db.query(models.TransceiverModule).filter(
        (models.TransceiverModule.connector_id == connector_id)
        | (models.TransceiverModule.cage_connector_id == connector_id)
    ).count()
    if used_by_templates or used_by_interfaces or used_by_modules:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Разъём используется: портов в шаблонах — {used_by_templates}, "
                f"портов устройств — {used_by_interfaces}, модулей — {used_by_modules}. "
                "Сначала замените его там."
            ),
        )
    db.delete(connector)
    db.commit()


# ---------- Модули (трансиверы) ----------
def _check_connectors(db: Session, data: dict) -> None:
    """Разъёмы у модуля должны существовать: иначе ссылка на пустоту
    доезжала до базы и возвращалась пятисоткой вместо внятного отказа."""
    for field in ("cage_connector_id", "connector_id"):
        value = data.get(field)
        if value is not None and not db.get(models.ConnectorType, value):
            raise HTTPException(status_code=404, detail="Разъём не найден")



@router.get("/modules", response_model=list[schemas.TransceiverModuleOut])
def list_modules(db: Session = Depends(get_db)):
    return db.query(models.TransceiverModule).order_by(models.TransceiverModule.name).all()


@router.post("/modules", response_model=schemas.TransceiverModuleOut, status_code=201)
def create_module(payload: schemas.TransceiverModuleCreate, db: Session = Depends(get_db),
                   _: models.User = Depends(auth.can_edit)):
    if db.query(models.TransceiverModule).filter(models.TransceiverModule.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Модуль с таким названием уже есть")
    _check_connectors(db, payload.model_dump())
    module = models.TransceiverModule(**payload.model_dump())
    db.add(module)
    db.commit()
    db.refresh(module)
    return module


@router.patch("/modules/{module_id}", response_model=schemas.TransceiverModuleOut)
def update_module(module_id: int, payload: schemas.TransceiverModuleUpdate, db: Session = Depends(get_db),
                   _: models.User = Depends(auth.can_edit)):
    module = db.get(models.TransceiverModule, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Модуль не найден")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and db.query(models.TransceiverModule).filter(
        models.TransceiverModule.name == data["name"], models.TransceiverModule.id != module_id
    ).first():
        raise HTTPException(status_code=409, detail="Модуль с таким названием уже есть")
    _check_connectors(db, data)
    for field, value in data.items():
        setattr(module, field, value)
    db.commit()
    db.refresh(module)
    return module


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(module_id: int, db: Session = Depends(get_db),
                   _: models.User = Depends(auth.can_edit)):
    module = db.get(models.TransceiverModule, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Модуль не найден")
    used = db.query(models.Interface).filter(models.Interface.module_id == module_id).count()
    if used:
        raise HTTPException(
            status_code=409,
            detail=f"Модуль вставлен в {used} порт(ов) — сначала выньте его там",
        )
    db.delete(module)
    db.commit()


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
