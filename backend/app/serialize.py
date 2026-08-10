"""Сборка InterfaceOut/DeviceOut с вычисляемым статусом порта
(свободен / подключён к <устройство, порт>). Статус нигде не хранится —
считается по наличию записи в links, поэтому собирается тут, а не
отдаётся FastAPI напрямую из ORM-объекта."""

from dataclasses import dataclass
from typing import Iterable, Dict, List, Optional
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app import models, schemas


@dataclass
class LinkEnd:
    """Связь глазами одного из её портов. connected_to пусто, если второй
    конец подвешен — порт при этом всё равно занят."""
    link_id: int
    connected_to: Optional[schemas.ConnectedTo]


def build_link_map(db: Session, interface_ids: Iterable[int]) -> Dict[int, "LinkEnd"]:
    """Для набора id интерфейсов одним запросом находит все связи и
    возвращает map: interface_id -> связь с точки зрения этого интерфейса.

    Другая сторона может отсутствовать: порт, в который был воткнут кабель,
    удалили (сняли сетевую карту), и конец остался подвешенным. Такой порт
    всё равно занят — предлагать его для нового подключения нельзя."""
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

    result: Dict[int, LinkEnd] = {}
    for link in links:
        pairs = [(link.interface_a, link.interface_b), (link.interface_b, link.interface_a)]
        for this_iface, other_iface in pairs:
            if this_iface is None or this_iface.id not in ids:
                continue
            connected = None
            if other_iface is not None:
                connected = schemas.ConnectedTo(
                    link_id=link.id,
                    device_id=other_iface.device_id,
                    device_code=other_iface.device.code,
                    device_name=other_iface.device.name,
                    interface_id=other_iface.id,
                    interface_label=other_iface.label,
                )
            result[this_iface.id] = LinkEnd(link_id=link.id, connected_to=connected)
    return result


def build_trunk_map(db: Session, interface_ids: Iterable[int]) -> Dict[int, List[int]]:
    """Транковые VLAN для набора портов — одним запросом на весь набор.

    Наружу они по-прежнему отдаются списком чисел: для клиента ничего не
    изменилось, изменилось только то, что теперь этот список не может
    содержать несуществующий VLAN.
    """
    ids = list(interface_ids)
    if not ids:
        return {}
    rows = (
        db.query(models.InterfaceTrunkVlan.interface_id, models.InterfaceTrunkVlan.vlan_id)
        .filter(models.InterfaceTrunkVlan.interface_id.in_(ids))
        .order_by(models.InterfaceTrunkVlan.vlan_id)
        .all()
    )
    result: Dict[int, List[int]] = {}
    for interface_id, vlan_id in rows:
        result.setdefault(interface_id, []).append(vlan_id)
    return result


def serialize_interface(iface: models.Interface, link_map: Dict[int, LinkEnd],
                         trunk_map: Optional[Dict[int, List[int]]] = None) -> schemas.InterfaceOut:
    end = link_map.get(iface.id)
    connector = iface.connector
    module = iface.module
    # Что реально торчит из порта: у клетки это разъём вставленного модуля,
    # у обычного порта — свой. Клетка без модуля — порт, в который физически
    # нечем воткнуть кабель.
    effective = module.connector if module is not None and module.connector is not None else connector
    empty_cage = bool(connector is not None and connector.is_cage and module is None)

    return schemas.InterfaceOut(
        id=iface.id,
        device_id=iface.device_id,
        label=iface.label,
        port_number=iface.port_number,
        mode=iface.mode,
        connector=schemas.ConnectorTypeOut.model_validate(connector) if connector else None,
        module=schemas.TransceiverModuleOut.model_validate(module) if module else None,
        connector_effective=schemas.ConnectorTypeOut.model_validate(effective) if effective else None,
        empty_cage=empty_cage,
        vlan_id=iface.vlan_id,
        trunk_vlan_ids=(trunk_map or {}).get(iface.id) or None,
        ip=iface.ip,
        mac=iface.mac,
        notes=iface.notes,
        link_id=end.link_id if end else None,
        connected_to=end.connected_to if end else None,
    )


def serialize_interfaces(db: Session, interfaces: List[models.Interface]) -> List[schemas.InterfaceOut]:
    link_map = build_link_map(db, (i.id for i in interfaces))
    trunk_map = build_trunk_map(db, (i.id for i in interfaces))
    return [serialize_interface(i, link_map, trunk_map) for i in interfaces]


def serialize_device(device: models.Device, link_map: Optional[Dict[int, LinkEnd]] = None,
                      db: Optional[Session] = None,
                      trunk_map: Optional[Dict[int, List[int]]] = None) -> schemas.DeviceOut:
    if link_map is None:
        link_map = build_link_map(db, (i.id for i in device.interfaces))
    if trunk_map is None and db is not None:
        trunk_map = build_trunk_map(db, (i.id for i in device.interfaces))
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
        interfaces=[serialize_interface(i, link_map, trunk_map) for i in device.interfaces],
        tags=[schemas.TagOut.model_validate(t) for t in device.tags],
    )


def serialize_devices(db: Session, devices: List[models.Device]) -> List[schemas.DeviceOut]:
    all_iface_ids = [i.id for d in devices for i in d.interfaces]
    link_map = build_link_map(db, all_iface_ids)
    trunk_map = build_trunk_map(db, all_iface_ids)
    return [serialize_device(d, link_map, trunk_map=trunk_map) for d in devices]


def serialize_device_list(db: Session, devices: List[models.Device]) -> List[schemas.DeviceListItem]:
    """Устройства для списка: без портов, но с их счётчиком.

    Счётчики считаются двумя групповыми запросами на всю страницу, а не
    обращением к портам каждого устройства: пятьдесят устройств — это
    пятьдесят лишних запросов, и именно из таких мелочей список и становился
    медленным.
    """
    ids = [d.id for d in devices]
    if not ids:
        return []

    totals = dict(
        db.query(models.Interface.device_id, func.count(models.Interface.id))
        .filter(models.Interface.device_id.in_(ids))
        .group_by(models.Interface.device_id)
        .all()
    )
    # Занятым считается и порт с подвешенным кабелем: кабель-то в него воткнут.
    connected = dict(
        db.query(models.Interface.device_id, func.count(models.Interface.id))
        .join(models.Link, or_(models.Link.interface_a_id == models.Interface.id,
                               models.Link.interface_b_id == models.Interface.id))
        .filter(models.Interface.device_id.in_(ids))
        .group_by(models.Interface.device_id)
        .all()
    )

    return [
        schemas.DeviceListItem(
            id=d.id, template_id=d.template_id, code=d.code, name=d.name,
            management_ip=d.management_ip, location=d.location, role=d.role,
            install_date=d.install_date, notes=d.notes,
            topology_group_id=d.topology_group_id,
            topology_x=d.topology_x, topology_y=d.topology_y,
            ports_total=totals.get(d.id, 0),
            ports_connected=connected.get(d.id, 0),
            tags=[schemas.TagOut.model_validate(t) for t in d.tags],
        )
        for d in devices
    ]


def serialize_links(db: Session, links: List[models.Link]) -> List[schemas.LinkOut]:
    """Связи с подписями концов.

    Без них страница связей вынуждена держать в памяти все устройства со
    всеми портами только ради того, чтобы вместо «интерфейс 4312» написать
    «SW-0003 · №2 Gi0/2».
    """
    iface_ids = [i for link in links for i in (link.interface_a_id, link.interface_b_id) if i]
    ends: Dict[int, schemas.LinkEndOut] = {}
    if iface_ids:
        rows = (
            db.query(models.Interface, models.Device)
            .join(models.Device, models.Device.id == models.Interface.device_id)
            .filter(models.Interface.id.in_(set(iface_ids)))
            .all()
        )
        ends = {
            iface.id: schemas.LinkEndOut(
                device_id=device.id, device_code=device.code, device_name=device.name,
                interface_id=iface.id, interface_label=iface.label, port_number=iface.port_number,
            )
            for iface, device in rows
        }

    result = []
    for link in links:
        item = schemas.LinkOut.model_validate(link)
        item.end_a = ends.get(link.interface_a_id) if link.interface_a_id else None
        item.end_b = ends.get(link.interface_b_id) if link.interface_b_id else None
        result.append(item)
    return result
