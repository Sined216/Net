from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, ports, schemas, auth, serialize, sites
from app.audit import log_change
from app.codegen import next_device_code

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[schemas.DeviceOut])
def list_devices(tag_id: int | None = None, template_id: int | None = None,
                  device_type_id: int | None = None, topology_group_id: int | None = None,
                  db: Session = Depends(get_db), site_id: int = Depends(sites.current_site_id)):
    q = (
        db.query(models.Device)
        .options(joinedload(models.Device.interfaces), joinedload(models.Device.tags))
        .filter(models.Device.site_id == site_id)
    )
    if tag_id is not None:
        q = q.filter(models.Device.tags.any(models.Tag.id == tag_id))
    if topology_group_id is not None:
        q = q.filter(models.Device.topology_group_id == topology_group_id)
    if template_id is not None:
        q = q.filter(models.Device.template_id == template_id)
    if device_type_id is not None:
        q = q.join(models.DeviceTemplate, models.Device.template_id == models.DeviceTemplate.id).filter(
            models.DeviceTemplate.device_type_id == device_type_id
        )
    devices = q.order_by(models.Device.code).all()
    return serialize.serialize_devices(db, devices)


@router.get("/{device_id}", response_model=schemas.DeviceOut)
def get_device(device_id: int, db: Session = Depends(get_db),
                site_id: int = Depends(sites.current_site_id)):
    device = (
        db.query(models.Device)
        .options(joinedload(models.Device.interfaces), joinedload(models.Device.tags))
        .filter(models.Device.id == device_id, models.Device.site_id == site_id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    return serialize.serialize_device(device, db=db)


@router.post("", response_model=schemas.DeviceOut, status_code=201)
def create_device(payload: schemas.DeviceCreate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit),
                   site_id: int = Depends(sites.current_site_id)):
    template = (
        db.query(models.DeviceTemplate)
        .options(joinedload(models.DeviceTemplate.interfaces), joinedload(models.DeviceTemplate.device_type))
        .filter(models.DeviceTemplate.id == payload.template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    if payload.topology_group_id is not None:
        if not db.query(models.TopologyGroup).filter(
            models.TopologyGroup.id == payload.topology_group_id,
            models.TopologyGroup.site_id == site_id,
        ).first():
            raise HTTPException(status_code=404, detail="Группа топологии не найдена")

    data = payload.model_dump(exclude={"template_id", "tag_ids"})
    if payload.tag_ids:
        # Теги — только своей площадки: чужой тег на устройстве вытащил бы
        # железку в чужой список.
        tags = db.query(models.Tag).filter(
            models.Tag.id.in_(payload.tag_ids), models.Tag.site_id == site_id,
        ).all()
        if len(tags) != len(set(payload.tag_ids)):
            raise HTTPException(status_code=404, detail="Один из тегов не найден")
    else:
        tags = []

    code = next_device_code(db, template.device_type.code_prefix)
    device = models.Device(template_id=template.id, code=code, created_by=user.id, tags=tags,
                           site_id=site_id, **data)
    db.add(device)
    db.flush()  # получить device.id

    for tpl_iface in template.interfaces:
        db.add(models.Interface(
            device_id=device.id, site_id=site_id, port_number=tpl_iface.port_number,
            label=tpl_iface.label, connector_id=tpl_iface.connector_id,
            template_interface_id=tpl_iface.id,
        ))

    log_change(db, user.id, "create", "device", None, old=None, new=device)
    db.commit()
    db.refresh(device)
    return serialize.serialize_device(device, db=db)


@router.put("/{device_id}/tags", response_model=schemas.DeviceOut)
def set_device_tags(device_id: int, payload: schemas.DeviceTagsUpdate, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit),
                     site_id: int = Depends(sites.current_site_id)):
    device = db.query(models.Device).options(joinedload(models.Device.tags)).filter(
        models.Device.id == device_id, models.Device.site_id == site_id
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")

    tags = db.query(models.Tag).filter(
        models.Tag.id.in_(payload.tag_ids), models.Tag.site_id == site_id,
    ).all()
    if len(tags) != len(set(payload.tag_ids)):
        raise HTTPException(status_code=404, detail="Один из тегов не найден")

    old_snapshot = {"tags": [t.id for t in device.tags]}
    device.tags = tags
    log_change(db, user.id, "update", "device", device.id, old=old_snapshot, new={"tags": payload.tag_ids})
    db.commit()
    db.refresh(device)
    return serialize.serialize_device(device, db=db)


@router.patch("/{device_id}", response_model=schemas.DeviceOut)
def update_device(device_id: int, payload: schemas.DeviceUpdate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit),
                   site_id: int = Depends(sites.current_site_id)):
    device = db.query(models.Device).filter(
        models.Device.id == device_id, models.Device.site_id == site_id
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")

    data = payload.model_dump(exclude_unset=True)
    if data.get("topology_group_id") is not None:
        if not db.query(models.TopologyGroup).filter(
            models.TopologyGroup.id == data["topology_group_id"],
            models.TopologyGroup.site_id == site_id,
        ).first():
            raise HTTPException(status_code=404, detail="Группа топологии не найдена")

    old_snapshot = {c.name: getattr(device, c.name) for c in device.__table__.columns}
    for field, value in data.items():
        setattr(device, field, value)

    log_change(db, user.id, "update", "device", device.id, old=old_snapshot, new=device)
    db.commit()
    db.refresh(device)
    return serialize.serialize_device(device, db=db)


@router.patch("/{device_id}/position", response_model=schemas.DeviceOut)
def update_device_position(device_id: int, payload: schemas.DevicePositionUpdate, db: Session = Depends(get_db),
                            _: models.User = Depends(auth.can_edit),
                            site_id: int = Depends(sites.current_site_id)):
    """Позиция узла на топологии — отдельная от общей формы редактирования,
    вызывается при отпускании перетаскиваемого узла. Без записи в audit_log:
    это UI-состояние диаграммы, а не содержательное изменение устройства."""
    device = db.query(models.Device).filter(
        models.Device.id == device_id, models.Device.site_id == site_id
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    device.topology_x = payload.x
    device.topology_y = payload.y
    db.commit()
    db.refresh(device)
    return serialize.serialize_device(device, db=db)


@router.delete("/{device_id}", status_code=204)
def delete_device(device_id: int, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit),
                   site_id: int = Depends(sites.current_site_id)):
    """Удалить устройство вместе с его портами и связями.

    Связи удаляются целиком, а не повисают: устройства больше нет в
    спецификации, и кабель «в никуда» тут не документ, а мусор. Подвешенный
    конец — история про снятый порт у живого устройства, где кабель
    действительно остался проложен.
    """
    device = db.query(models.Device).filter(
        models.Device.id == device_id, models.Device.site_id == site_id
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")

    interface_ids = [i.id for i in device.interfaces]
    if interface_ids:
        db.query(models.Link).filter(
            or_(
                models.Link.interface_a_id.in_(interface_ids),
                models.Link.interface_b_id.in_(interface_ids),
            )
        ).delete(synchronize_session=False)

    old_snapshot = {c.name: getattr(device, c.name) for c in device.__table__.columns}
    log_change(db, user.id, "delete", "device", device.id, old=old_snapshot, new=None)
    db.delete(device)
    db.commit()


# ---------- Интерфейсы конкретного устройства ----------
@router.get("/{device_id}/interfaces", response_model=list[schemas.InterfaceOut])
def list_interfaces(device_id: int, db: Session = Depends(get_db),
                     site_id: int = Depends(sites.current_site_id)):
    ifaces = db.query(models.Interface).filter(
        models.Interface.device_id == device_id, models.Interface.site_id == site_id,
    ).order_by(
        models.Interface.port_number
    ).all()
    return serialize.serialize_interfaces(db, ifaces)


PORTS_FIXED_BY_TEMPLATE = (
    "Состав портов этой модели задаётся в шаблоне устройства — правьте его там, "
    "изменение применится ко всем устройствам этой модели. "
    "Если у модели порты меняются по факту (например ПК со съёмной сетевой картой), "
    "включите в шаблоне «состав портов меняется на устройстве»."
)


def _require_editable_ports(db: Session, device: models.Device) -> None:
    """Порты — свойство модели, а не отдельной железки.

    Иначе одинаковые коммутаторы разъезжаются по составу портов, и понять, где
    правда, невозможно. Исключение делается явно, флагом на шаблоне: у ПК
    сетевую карту действительно доставляют и снимают.
    """
    template = db.query(models.DeviceTemplate).filter(
        models.DeviceTemplate.id == device.template_id
    ).first()
    if template is not None and not template.ports_editable_on_device:
        raise HTTPException(status_code=409, detail=PORTS_FIXED_BY_TEMPLATE)


@router.post("/{device_id}/interfaces", response_model=schemas.InterfaceOut, status_code=201)
def add_interface(device_id: int, payload: schemas.InterfaceCreate, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit),
                   site_id: int = Depends(sites.current_site_id)):
    """Добавить порт конкретному устройству.

    Разрешено только моделям с изменяемым составом портов — например ПК,
    в который доставили сетевую карту."""
    # Блокировка строки устройства: одновременные добавления иначе читают
    # один и тот же следующий номер и мешают друг другу.
    device = db.query(models.Device).filter(
        models.Device.id == device_id, models.Device.site_id == site_id
    ).with_for_update().first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    _require_editable_ports(db, device)
    if payload.connector_id is not None and not db.get(models.ConnectorType, payload.connector_id):
        raise HTTPException(status_code=404, detail="Разъём не найден")
    if payload.vlan_id is not None and not db.query(models.Vlan).filter(
        models.Vlan.id == payload.vlan_id, models.Vlan.site_id == site_id
    ).first():
        raise HTTPException(status_code=404, detail="VLAN не найден")

    number = ports.next_number(db, models.Interface, "device_id", device_id)
    iface = models.Interface(device_id=device_id, site_id=site_id, port_number=number,
                             **payload.model_dump())
    db.add(iface)
    log_change(db, user.id, "create", "interface", None, old=None, new=iface)
    db.commit()
    db.refresh(iface)
    return serialize.serialize_interface(iface, {})


@router.post("/{device_id}/interfaces/bulk", response_model=list[schemas.InterfaceOut], status_code=201)
def add_interfaces_bulk(device_id: int, payload: schemas.PortsBulkCreate, db: Session = Depends(get_db),
                         user: models.User = Depends(auth.can_edit),
                         site_id: int = Depends(sites.current_site_id)):
    """Добавить устройству сразу N портов — одной транзакцией."""
    device = db.query(models.Device).filter(
        models.Device.id == device_id, models.Device.site_id == site_id
    ).with_for_update().first()
    if not device:
        raise HTTPException(status_code=404, detail="Устройство не найдено")
    _require_editable_ports(db, device)
    if payload.connector_id is not None and not db.get(models.ConnectorType, payload.connector_id):
        raise HTTPException(status_code=404, detail="Разъём не найден")

    start = ports.next_number(db, models.Interface, "device_id", device_id)
    created = []
    for offset in range(payload.count):
        number = start + offset
        iface = models.Interface(
            device_id=device_id, site_id=site_id, port_number=number, label=f"Порт {number}",
            connector_id=payload.connector_id,
        )
        db.add(iface)
        created.append(iface)

    log_change(db, user.id, "create", "interface", None, old=None,
               new={"добавлено портов": payload.count})
    db.commit()
    for iface in created:
        db.refresh(iface)
    return [serialize.serialize_interface(iface, {}) for iface in created]
