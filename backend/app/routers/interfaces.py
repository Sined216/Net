from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import Text, cast, or_

from app.database import get_db
from app import cables, models, ports, schemas, auth, serialize, sites, versioning
from app.audit import log_change
from app.routers.devices import _mac_like, _require_editable_ports

router = APIRouter(tags=["interfaces"])


@router.patch("/interfaces/{interface_id}", response_model=schemas.InterfaceOut)
def update_interface(interface_id: int, payload: schemas.InterfaceUpdate, db: Session = Depends(get_db),
                      user: models.User = Depends(auth.can_edit),
                      site_id: int = Depends(sites.current_site_id)):
    iface = db.query(models.Interface).filter(
        models.Interface.id == interface_id, models.Interface.site_id == site_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")

    versioning.check(iface, payload.version)
    data = payload.model_dump(exclude_unset=True, exclude={"version"})
    # Транковые VLAN живут отдельной таблицей и правятся не присваиванием
    # поля, а заменой набора строк — поэтому вынимаются из общего разбора.
    trunk_ids = data.pop("trunk_vlan_ids", "не задано")
    if data.get("vlan_id") is not None and not db.query(models.Vlan).filter(
        models.Vlan.id == data["vlan_id"], models.Vlan.site_id == site_id
    ).first():
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
    old_snapshot["trunk_vlan_ids"] = sorted(t.vlan_id for t in iface.trunk_vlans)
    changed = versioning.differs(iface, data)
    for field, value in data.items():
        setattr(iface, field, value)

    if trunk_ids != "не задано":
        before = {t.vlan_id for t in iface.trunk_vlans}
        _set_trunk_vlans(db, iface, trunk_ids or [], site_id)
        changed = changed or before != {t.vlan_id for t in iface.trunk_vlans}
    if changed:
        versioning.bump(iface)

    new_snapshot = {c.name: getattr(iface, c.name) for c in iface.__table__.columns}
    new_snapshot["trunk_vlan_ids"] = sorted(t.vlan_id for t in iface.trunk_vlans)
    log_change(db, user.id, "update", "interface", iface.id, old=old_snapshot, new=new_snapshot,
               site_id=site_id)
    db.commit()
    db.refresh(iface)
    link_map = serialize.build_link_map(db, [iface.id])
    trunk_map = serialize.build_trunk_map(db, [iface.id])
    return serialize.serialize_interface(iface, link_map, trunk_map)


def _set_trunk_vlans(db: Session, iface: models.Interface, vlan_ids: list[int], site_id: int) -> None:
    """Заменить набор транковых VLAN порта.

    Проверка «VLAN существует и он этой площадки» есть и в базе — составными
    ключами, — но там она даёт 500 с текстом про нарушение ограничения.
    Здесь то же самое сказано человеческим языком; база остаётся последней
    линией, а не единственной.
    """
    wanted = sorted(set(vlan_ids))
    if wanted:
        found = {
            v.id for v in db.query(models.Vlan.id).filter(
                models.Vlan.id.in_(wanted), models.Vlan.site_id == site_id,
            )
        }
        missing = [v for v in wanted if v not in found]
        if missing:
            raise HTTPException(
                status_code=404,
                detail=f"VLAN не найден на этой площадке: {', '.join(map(str, missing))}",
            )

    current = {t.vlan_id: t for t in iface.trunk_vlans}
    for vlan_id, row in current.items():
        if vlan_id not in wanted:
            iface.trunk_vlans.remove(row)
    for vlan_id in wanted:
        if vlan_id not in current:
            iface.trunk_vlans.append(
                models.InterfaceTrunkVlan(vlan_id=vlan_id, site_id=site_id)
            )
    db.flush()


@router.delete("/interfaces/{interface_id}", status_code=204)
def delete_interface(interface_id: int, db: Session = Depends(get_db),
                      user: models.User = Depends(auth.can_edit),
                      site_id: int = Depends(sites.current_site_id)):
    """Убрать порт у конкретного устройства (сняли сетевую карту).

    Связь при этом не удаляется: кабель остался проложен, у него повисает
    конец — подключить его заново можно к другому порту.
    Разрешено только моделям с изменяемым составом портов."""
    iface = db.query(models.Interface).filter(
        models.Interface.id == interface_id, models.Interface.site_id == site_id
    ).first()
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


@router.get("/interfaces/free", response_model=list[schemas.FreePortOut])
def free_interfaces(q: str | None = None, exclude_device_id: int | None = None,
                     device_id: int | None = None,
                     limit: int = Query(default=50, ge=1, le=200),
                     db: Session = Depends(get_db),
                     site_id: int = Depends(sites.current_site_id)):
    """Свободные порты — для выпадающего списка «куда воткнуть».

    Раньше этот список собирался в браузере из всех устройств со всеми
    портами: чтобы предложить десяток вариантов, приходилось привезти
    двадцать четыре тысячи. Теперь свободные порты ищет база, а сколько их
    показать — решает limit.

    Занятым считается и порт с подвешенным кабелем: кабель в него воткнут,
    второй его конец просто некуда включить.

    `device_id` сужает список до одной железки — без него на площадке с
    большим числом свободных портов общий (по коду устройства) список из
    `limit` записей мог не дотянуться до нужного устройства вовсе: правка
    связи на схеме просила «переткнуть» кабель в другой порт той же
    железки, а порт в выпадающем списке не появлялся.
    """
    busy = db.query(models.Link.interface_a_id).filter(models.Link.interface_a_id.isnot(None)).union(
        db.query(models.Link.interface_b_id).filter(models.Link.interface_b_id.isnot(None))
    ).subquery()

    query = (
        db.query(models.Interface, models.Device, models.DeviceTemplate)
        .join(models.Device, models.Device.id == models.Interface.device_id)
        .outerjoin(models.DeviceTemplate, models.DeviceTemplate.id == models.Device.template_id)
        .filter(models.Interface.site_id == site_id)
        .filter(models.Interface.id.notin_(db.query(busy)))
    )
    if exclude_device_id is not None:
        query = query.filter(models.Interface.device_id != exclude_device_id)
    if device_id is not None:
        query = query.filter(models.Interface.device_id == device_id)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        query = query.filter(or_(
            models.Device.code.ilike(like),
            models.Device.name.ilike(like),
            models.Interface.label.ilike(like),
        ))

    rows = query.order_by(models.Device.code, models.Interface.port_number).limit(limit).all()
    return [
        schemas.FreePortOut(
            interface_id=iface.id, label=iface.label, port_number=iface.port_number,
            device_id=device.id, device_code=device.code, device_name=device.name,
            device_template_name=template.name if template else None,
        )
        for iface, device, template in rows
    ]


@router.get("/search", response_model=list[schemas.SearchResult])
def search(query: str, db: Session = Depends(get_db),
            site_id: int = Depends(sites.current_site_id)):
    """Найти устройство — по имени, коду, своему IP или MAC — либо порт —
    по IP или MAC конкретного гнезда.

    Раньше здесь был один запрос, INNER JOIN от порта к устройству: он не
    видел устройство без единого порта (медиаконвертер, ИБП), не смотрел на
    `Device.management_ip`/`Device.mac` вовсе, а совпадение по имени или
    коду устройства фан-аутилось на одну строку на каждый порт — коммутатор
    на 24 порта одним найденным устройством съедал почти весь лимит выдачи.

    Теперь два независимых запроса: устройство находится по своим полям —
    одной строкой, порт — по своим, отдельной строкой на каждое совпадение.
    Строка устройства порта не называет (`interface_id`/`interface_label`
    пусты) — искали не гнездо, показывать какое-то одно было бы обманом.
    """
    # % и _ в ILIKE — шаблоны, а не символы: запрос «%» возвращал вообще всё,
    # а «10_10» находил и «10.10», и «10x10». Человек ищет текст, а не пишет
    # шаблон, поэтому спецсимволы экранируются.
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    like = f"%{escaped}%"

    devices = (
        db.query(models.Device)
        .filter(
            models.Device.site_id == site_id,
            or_(
                models.Device.name.ilike(like),
                models.Device.code.ilike(like),
                cast(models.Device.management_ip, Text).ilike(like),
                _mac_like(models.Device.mac, query),
            ),
        )
        .limit(50)
        .all()
    )
    interfaces = (
        db.query(models.Interface, models.Device)
        .join(models.Device, models.Device.id == models.Interface.device_id)
        .filter(
            # Поиск не должен обходить изоляцию: чужая железка не находится
            # ни по IP, ни по коду, ни через свой порт.
            models.Device.site_id == site_id,
            or_(
                cast(models.Interface.ip, Text).ilike(like),
                _mac_like(models.Interface.mac, query),
            ),
        )
        .limit(50)
        .all()
    )
    results = [
        schemas.SearchResult(device_id=d.id, device_code=d.code, device_name=d.name, ip=d.management_ip, mac=d.mac)
        for d in devices
    ] + [
        schemas.SearchResult(
            device_id=d.id, device_code=d.code, device_name=d.name,
            interface_id=i.id, interface_label=i.label, ip=i.ip, mac=i.mac,
        )
        for i, d in interfaces
    ]
    return results[:50]
