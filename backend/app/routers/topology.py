from fastapi import APIRouter, Depends
from sqlalchemy import distinct, func, select, union_all
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import models, schemas, sites

router = APIRouter(tags=["topology"])


def _port_vlans(db: Session, device_ids: set[int]):
    """VLAN по портам устройств из `device_ids` — access и транк разом.

    Один подзапрос вместо двух раздельных: `interfaces.vlan_id` (access) и
    `interface_trunk_vlans` (транк) объединяются `UNION ALL` в общий набор
    строк «устройство — порт — VLAN», а дальше из него агрегацией в базе,
    не в питоне, получаются два готовых словаря — по устройству (для узла)
    и по порту (для конца кабеля). Строк в самом подзапросе столько,
    сколько у площадки пар «порт — VLAN» — с транком в несколько VLAN их
    будет больше одной на порт, но расти от общего числа портов (как боялись
    в комментарии к `/topology` выше) он не может: у порта без VLAN строки
    вовсе нет.
    """
    if not device_ids:
        return {}, {}

    access = select(
        models.Interface.device_id.label("device_id"),
        models.Interface.id.label("interface_id"),
        models.Interface.vlan_id.label("vlan_id"),
    ).where(
        models.Interface.device_id.in_(device_ids),
        models.Interface.vlan_id.isnot(None),
    )
    trunk = select(
        models.Interface.device_id.label("device_id"),
        models.InterfaceTrunkVlan.interface_id.label("interface_id"),
        models.InterfaceTrunkVlan.vlan_id.label("vlan_id"),
    ).select_from(models.InterfaceTrunkVlan).join(
        models.Interface, models.Interface.id == models.InterfaceTrunkVlan.interface_id,
    ).where(models.Interface.device_id.in_(device_ids))

    port_vlans = union_all(access, trunk).subquery("port_vlans")

    by_device: dict[int, list[int]] = {
        device_id: sorted(vlan_ids)
        for device_id, vlan_ids in db.query(
            port_vlans.c.device_id, func.array_agg(distinct(port_vlans.c.vlan_id)),
        ).group_by(port_vlans.c.device_id).all()
    }
    by_interface: dict[int, list[int]] = {
        interface_id: sorted(vlan_ids)
        for interface_id, vlan_ids in db.query(
            port_vlans.c.interface_id, func.array_agg(distinct(port_vlans.c.vlan_id)),
        ).group_by(port_vlans.c.interface_id).all()
    }
    return by_device, by_interface


@router.get("/topology", response_model=schemas.TopologyOut)
def get_topology(tag_id: int | None = None, db: Session = Depends(get_db),
                  site_id: int = Depends(sites.current_site_id)):
    """Всё, что нужно схеме связей, одним ответом.

    Раньше схема собиралась в браузере из двух запросов: устройства со всеми
    портами (`/topology/devices`) и страница связей. Порты составляли почти
    весь вес — двадцать четыре тысячи вложенных объектов на тысячу устройств
    ради того, чтобы подписать на карточке дробь «1/4» и написать у конца
    кабеля номер порта. Здесь то же самое считает база: карточке достаётся
    пара чисел, кабелю — номер и подпись его портов.

    Пять запросов на весь ответ: устройства, кабели, подсчёт портов и два
    на VLAN (`_port_vlans` — по устройству и по порту разом, см. её
    комментарий). Ни один не растёт от количества портов.
    """
    devices_q = db.query(models.Device).options(
        joinedload(models.Device.template).joinedload(models.DeviceTemplate.device_type),
        joinedload(models.Device.tags),
    ).filter(models.Device.site_id == site_id)
    if tag_id is not None:
        devices_q = devices_q.filter(models.Device.tags.any(models.Tag.id == tag_id))
    devices = devices_q.order_by(models.Device.code).all()
    device_ids = {d.id for d in devices}

    links = (
        db.query(models.Link)
        .options(
            joinedload(models.Link.interface_a),
            joinedload(models.Link.interface_b),
            joinedload(models.Link.template),
        )
        .filter(models.Link.site_id == site_id)
        .order_by(models.Link.id)
        .all()
    )

    ports_total = dict(
        db.query(models.Interface.device_id, func.count(models.Interface.id))
        .filter(models.Interface.site_id == site_id)
        .group_by(models.Interface.device_id)
        .all()
    )
    # Занятость порта нигде не хранится — она и есть наличие кабеля. Считаем
    # её по уже загруженным связям, а не отдельным запросом: один и тот же
    # порт в двух кабелях оказаться не может, но подвешенный конец тоже
    # занимает порт, поэтому считаются оба конца независимо.
    ports_connected: dict[int, int] = {}
    for link in links:
        for iface in (link.interface_a, link.interface_b):
            if iface is None:
                continue
            ports_connected[iface.device_id] = ports_connected.get(iface.device_id, 0) + 1

    vlans_by_device, vlans_by_interface = _port_vlans(db, device_ids)

    nodes = [
        schemas.TopologyNode(
            id=d.id, code=d.code, name=d.name,
            management_ip=str(d.management_ip) if d.management_ip else None,
            template_id=d.template_id,
            template_name=d.template.name if d.template else "",
            manufacturer=d.template.manufacturer if d.template else None,
            device_type=d.template.device_type.name if d.template and d.template.device_type else "",
            color=d.template.color if d.template else None,
            tag_ids=[t.id for t in d.tags],
            topology_group_id=d.topology_group_id,
            topology_x=d.topology_x,
            topology_y=d.topology_y,
            ports_total=ports_total.get(d.id, 0),
            ports_connected=ports_connected.get(d.id, 0),
            vlan_ids=vlans_by_device.get(d.id, []),
        )
        for d in devices
    ]

    edges = []
    for link in links:
        a, b = link.interface_a, link.interface_b
        dev_a = a.device_id if a else None
        dev_b = b.device_id if b else None
        # Отбор по тегу прячет часть устройств. Кабель, у которого пропало
        # хотя бы одно живое устройство, прятать приходится вместе с ними:
        # рисовать его не к чему. Повисший конец в этом смысле не в счёт —
        # он и так ни к какому устройству не привязан.
        live = [d for d in (dev_a, dev_b) if d is not None]
        if not live or any(d not in device_ids for d in live):
            continue
        # Объединение, не пересечение — см. комментарий у TopologyEdge.vlan_ids.
        edge_vlans = sorted(set(
            vlans_by_interface.get(link.interface_a_id, [])
            + vlans_by_interface.get(link.interface_b_id, [])
        ))
        edges.append(
            schemas.TopologyEdge(
                link_id=link.id,
                device_a_id=dev_a,
                device_b_id=dev_b,
                interface_a_id=link.interface_a_id,
                interface_b_id=link.interface_b_id,
                port_a_number=a.port_number if a else None,
                port_b_number=b.port_number if b else None,
                interface_a_label=a.label if a else None,
                interface_b_label=b.label if b else None,
                media_type=link.template.media_type if link.template else None,
                color=link.template.color if link.template else None,
                line_style=link.template.line_style if link.template else None,
                confirmed=link.confirmed,
                vlan_ids=edge_vlans,
            )
        )

    return schemas.TopologyOut(nodes=nodes, edges=edges)
