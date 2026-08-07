"""Сборка InterfaceOut/DeviceOut с вычисляемым статусом порта
(свободен / подключён к <устройство, порт>). Статус нигде не хранится —
считается по наличию записи в links, поэтому собирается тут, а не
отдаётся FastAPI напрямую из ORM-объекта."""

from typing import Iterable, Dict, List, Optional
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app import models, schemas


def build_link_map(db: Session, interface_ids: Iterable[int]) -> Dict[int, schemas.ConnectedTo]:
    """Для набора id интерфейсов одним запросом находит все связи и
    возвращает map: interface_id -> с чем соединён (с точки зрения этого
    интерфейса, т.е. "другая" сторона связи)."""
    ids = list(interface_ids)
    if not ids:
        return {}

    links = (
        db.query(models.Link)
        .options(
            joinedload(models.Link.interface_a).joinedload(models.Interface.device),
            joinedload(models.Link.interface_b).joinedload(models.Interface.device),
        )
        .filter(or_(models.Link.interface_a_id.in_(ids), models.Link.interface_b_id.in_(ids)))
        .all()
    )

    result: Dict[int, schemas.ConnectedTo] = {}
    for link in links:
        pairs = [(link.interface_a, link.interface_b), (link.interface_b, link.interface_a)]
        for this_iface, other_iface in pairs:
            if this_iface.id in ids:
                result[this_iface.id] = schemas.ConnectedTo(
                    link_id=link.id,
                    device_id=other_iface.device_id,
                    device_code=other_iface.device.code,
                    device_name=other_iface.device.name,
                    interface_id=other_iface.id,
                    interface_label=other_iface.label,
                )
    return result


def serialize_interface(iface: models.Interface, link_map: Dict[int, schemas.ConnectedTo]) -> schemas.InterfaceOut:
    return schemas.InterfaceOut(
        id=iface.id,
        device_id=iface.device_id,
        label=iface.label,
        port_number=iface.port_number,
        port_type=iface.port_type,
        vlan_id=iface.vlan_id,
        trunk_vlan_ids=iface.trunk_vlan_ids,
        ip=iface.ip,
        mac=iface.mac,
        notes=iface.notes,
        connected_to=link_map.get(iface.id),
    )


def serialize_interfaces(db: Session, interfaces: List[models.Interface]) -> List[schemas.InterfaceOut]:
    link_map = build_link_map(db, (i.id for i in interfaces))
    return [serialize_interface(i, link_map) for i in interfaces]


def serialize_device(device: models.Device, link_map: Optional[Dict[int, schemas.ConnectedTo]] = None,
                      db: Optional[Session] = None) -> schemas.DeviceOut:
    if link_map is None:
        link_map = build_link_map(db, (i.id for i in device.interfaces))
    return schemas.DeviceOut(
        id=device.id,
        template_id=device.template_id,
        code=device.code,
        name=device.name,
        management_ip=device.management_ip,
        location=device.location,
        role=device.role,
        install_date=device.install_date,
        notes=device.notes,
        topology_group_id=device.topology_group_id,
        topology_x=device.topology_x,
        topology_y=device.topology_y,
        created_at=device.created_at,
        updated_at=device.updated_at,
        interfaces=[serialize_interface(i, link_map) for i in device.interfaces],
        tags=[schemas.TagOut.model_validate(t) for t in device.tags],
    )


def serialize_devices(db: Session, devices: List[models.Device]) -> List[schemas.DeviceOut]:
    all_iface_ids = [i.id for d in devices for i in d.interfaces]
    link_map = build_link_map(db, all_iface_ids)
    return [serialize_device(d, link_map) for d in devices]
