from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import Text, cast, or_

from app.database import get_db
from app import cables, models, ports, schemas, auth, serialize
from app.audit import log_change
from app.routers.devices import _require_editable_ports

router = APIRouter(tags=["interfaces"])


@router.patch("/interfaces/{interface_id}", response_model=schemas.InterfaceOut)
def update_interface(interface_id: int, payload: schemas.InterfaceUpdate, db: Session = Depends(get_db),
                      user: models.User = Depends(auth.can_edit)):
    iface = db.query(models.Interface).filter(models.Interface.id == interface_id).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")

    data = payload.model_dump(exclude_unset=True)
    if data.get("vlan_id") is not None and not db.get(models.Vlan, data["vlan_id"]):
        raise HTTPException(status_code=404, detail="VLAN не найден")
    if data.get("module_id") is not None:
        module = db.get(models.TransceiverModule, data["module_id"])
        if not module:
            raise HTTPException(status_code=404, detail="Модуль не найден")
        # Модуль вставляется в клетку; в RJ45 его физически некуда деть, и
        # такая запись означала бы неверную документацию, а не факт.
        if iface.connector is None or not iface.connector.is_cage:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"В этот порт модуль не вставляется: у него разъём "
                    f"{iface.connector.name if iface.connector else 'не указан'}, а не клетка"
                ),
            )

    old_snapshot = {c.name: getattr(iface, c.name) for c in iface.__table__.columns}
    for field, value in data.items():
        setattr(iface, field, value)

    log_change(db, user.id, "update", "interface", iface.id, old=old_snapshot, new=iface)
    db.commit()
    db.refresh(iface)
    link_map = serialize.build_link_map(db, [iface.id])
    return serialize.serialize_interface(iface, link_map)


@router.delete("/interfaces/{interface_id}", status_code=204)
def delete_interface(interface_id: int, db: Session = Depends(get_db),
                      user: models.User = Depends(auth.can_edit)):
    """Убрать порт у конкретного устройства (сняли сетевую карту).

    Связь при этом не удаляется: кабель остался проложен, у него повисает
    конец — подключить его заново можно к другому порту.
    Разрешено только моделям с изменяемым составом портов."""
    iface = db.query(models.Interface).filter(models.Interface.id == interface_id).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")

    device = db.query(models.Device).filter(models.Device.id == iface.device_id).first()
    if device is not None:
        _require_editable_ports(db, device)

    old_snapshot = {c.name: getattr(iface, c.name) for c in iface.__table__.columns}
    log_change(db, user.id, "delete", "interface", iface.id, old=old_snapshot, new=None)
    device_id = iface.device_id
    # Если это был последний оставшийся конец кабеля, кабель исчезает вместе
    # с портом: висеть в спецификации, не будучи никуда воткнутым, он не может.
    cables.drop_cables_without_ends(db, [iface.id])
    db.delete(iface)
    # Ряд номеров остаётся сплошным: после снятой карты не должно оставаться
    # пропущенного номера — гнезда с таким номером у железки нет.
    ports.renumber(db, models.Interface, "device_id", device_id)
    db.commit()


@router.get("/search", response_model=list[schemas.SearchResult])
def search(query: str, db: Session = Depends(get_db)):
    """Найти по IP, MAC или имени/коду устройства.

    ip и mac приводятся к тексту: подстрочный поиск нужен, чтобы «10.10.»
    находил всю подсеть, а у типов inet и macaddr оператора ILIKE нет.
    MAC при сохранении нормализуется к виду aa:bb:cc:dd:ee:ff, так что
    искать по нему стоит в этой же записи.
    """
    like = f"%{query}%"
    rows = (
        db.query(models.Interface, models.Device)
        .join(models.Device, models.Device.id == models.Interface.device_id)
        .filter(
            or_(
                cast(models.Interface.ip, Text).ilike(like),
                cast(models.Interface.mac, Text).ilike(like),
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
