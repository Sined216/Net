from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app import cables, models, ports, schemas, auth
from app.audit import log_change

router = APIRouter(prefix="/device-templates", tags=["device-templates"])


@router.get("", response_model=list[schemas.DeviceTemplateOut])
def list_templates(device_type_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(models.DeviceTemplate).options(joinedload(models.DeviceTemplate.interfaces))
    if device_type_id is not None:
        q = q.filter(models.DeviceTemplate.device_type_id == device_type_id)
    return q.order_by(models.DeviceTemplate.name).all()


@router.get("/{template_id}", response_model=schemas.DeviceTemplateOut)
def get_template(template_id: int, db: Session = Depends(get_db)):
    template = (
        db.query(models.DeviceTemplate)
        .options(joinedload(models.DeviceTemplate.interfaces))
        .filter(models.DeviceTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    return template


@router.post("", response_model=schemas.DeviceTemplateOut, status_code=201)
def create_template(payload: schemas.DeviceTemplateCreate, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit)):
    device_type = db.query(models.DeviceType).filter(models.DeviceType.id == payload.device_type_id).first()
    if not device_type:
        raise HTTPException(status_code=404, detail="Тип устройства не найден")

    for iface in payload.interfaces:
        if iface.connector_id is not None and not db.get(models.ConnectorType, iface.connector_id):
            raise HTTPException(status_code=404, detail="Разъём не найден")

    data = payload.model_dump(exclude={"interfaces"})
    template = models.DeviceTemplate(**data)
    db.add(template)
    db.flush()  # получить template.id

    # Номера раздаются по порядку списка: ряд гнёзд сплошной, 1..N.
    for number, iface in enumerate(payload.interfaces, start=1):
        db.add(models.InterfaceTemplate(template_id=template.id, port_number=number, **iface.model_dump()))

    log_change(db, user.id, "create", "device_template", None, old=None, new=template)
    db.commit()
    db.refresh(template)
    return template


@router.patch("/{template_id}", response_model=schemas.DeviceTemplateOut)
def update_template(template_id: int, payload: schemas.DeviceTemplateUpdate, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit)):
    template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")

    old_snapshot = {c.name: getattr(template, c.name) for c in template.__table__.columns}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    log_change(db, user.id, "update", "device_template", template.id, old=old_snapshot, new=template)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, db: Session = Depends(get_db),
                     user: models.User = Depends(auth.can_edit)):
    template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    try:
        log_change(db, user.id, "delete", "device_template", template.id, old=None, new=None)
        db.delete(template)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="По этому шаблону уже заведены устройства в спецификации — сначала удалите их",
        ) from None


# ---------- Порты шаблона ----------
@router.post("/{template_id}/interfaces", response_model=schemas.InterfaceTemplateOut, status_code=201)
def add_template_interface(template_id: int, payload: schemas.InterfaceTemplateCreate,
                            db: Session = Depends(get_db), user: models.User = Depends(auth.can_edit)):
    """Добавить порт модели — и всем уже заведённым её экземплярам.

    Состав портов задаётся моделью, а не набивается у каждой железки
    отдельно: доукомплектовали модель — порт появляется у всех устройств
    этой модели. Номер новому порту даётся следующий по порядку: ряд гнёзд
    сплошной, и своего номера у порта в модели и в устройстве быть не
    может — он один и тот же.
    """
    # Строка модели блокируется до конца транзакции: без этого два
    # одновременных добавления вычисляют один и тот же следующий номер, и
    # второе отбивается уникальным индексом.
    template = db.query(models.DeviceTemplate).filter(
        models.DeviceTemplate.id == template_id
    ).with_for_update().first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")

    if payload.connector_id is not None and not db.get(models.ConnectorType, payload.connector_id):
        raise HTTPException(status_code=404, detail="Разъём не найден")

    number = ports.next_number(db, models.InterfaceTemplate, "template_id", template_id)
    iface = models.InterfaceTemplate(template_id=template_id, port_number=number, **payload.model_dump())
    db.add(iface)
    db.flush()  # нужен id порта модели: устройства ссылаются именно на него

    # Модель техники общая для всех площадок, поэтому новый порт доезжает до
    # её устройств на каждой из них — вместе с площадкой самого устройства.
    device_sites = dict(
        db.query(models.Device.id, models.Device.site_id)
        .filter(models.Device.template_id == template_id).all()
    )
    device_ids = list(device_sites)
    # У устройства со съёмными портами к портам модели могут быть добавлены
    # свои; порт модели встаёт сразу за портами модели, а самодельные
    # сдвигаются дальше. Считается сразу по всем устройствам: поштучно на
    # тысяче станков это складывалось в минуты.
    ports.make_room(db, models.Interface, "device_id", device_ids, number)
    for device_id in device_ids:
        db.add(models.Interface(
            device_id=device_id, site_id=device_sites[device_id], port_number=number,
            label=payload.label, connector_id=payload.connector_id,
            template_interface_id=iface.id,
        ))
    ports.renumber(db, models.Interface, "device_id", device_ids)

    log_change(db, user.id, "update", "device_template", template_id,
               old=None, new={"добавлен порт": f"№{number} {payload.label}",
                              "устройств затронуто": len(device_ids)})
    db.commit()
    db.refresh(iface)
    return iface


@router.post("/{template_id}/interfaces/bulk", response_model=list[schemas.InterfaceTemplateOut], status_code=201)
def add_template_interfaces_bulk(template_id: int, payload: schemas.PortsBulkCreate,
                                  db: Session = Depends(get_db), user: models.User = Depends(auth.can_edit)):
    """Добавить сразу N портов модели — и всем её устройствам.

    Одним запросом и одной транзакцией: двадцать четыре параллельных
    добавления читают один и тот же «следующий номер», и до базы доезжают
    два-три порта из двадцати четырёх.
    """
    template = db.query(models.DeviceTemplate).filter(
        models.DeviceTemplate.id == template_id
    ).with_for_update().first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")
    if payload.connector_id is not None and not db.get(models.ConnectorType, payload.connector_id):
        raise HTTPException(status_code=404, detail="Разъём не найден")

    start = ports.next_number(db, models.InterfaceTemplate, "template_id", template_id)
    device_sites = dict(
        db.query(models.Device.id, models.Device.site_id)
        .filter(models.Device.template_id == template_id).all()
    )
    device_ids = list(device_sites)

    # Место под всю пачку освобождается один раз, а не под каждый порт: у
    # модели с полусотней устройств поштучный сдвиг с перенумерацией
    # занимал секунды на каждый порт.
    # Сдвиг с запасом на всю пачку: иначе вставляемые номера налетают на
    # только что сдвинутые.
    ports.make_room(db, models.Interface, "device_id", device_ids, start, reserve=payload.count)

    created = []
    for offset in range(payload.count):
        number = start + offset
        label = f"Порт {number}"
        iface = models.InterfaceTemplate(
            template_id=template_id, port_number=number, label=label, connector_id=payload.connector_id,
        )
        db.add(iface)
        db.flush()
        created.append(iface)
        for device_id in device_ids:
            db.add(models.Interface(
                device_id=device_id, site_id=device_sites[device_id], port_number=number,
                label=label, connector_id=payload.connector_id,
                template_interface_id=iface.id,
            ))
    ports.renumber(db, models.Interface, "device_id", device_ids)

    log_change(db, user.id, "update", "device_template", template_id,
               old=None, new={"добавлено портов": payload.count, "устройств затронуто": len(device_ids)})
    db.commit()
    for iface in created:
        db.refresh(iface)
    return created


@router.patch("/{template_id}/interfaces/{iface_id}", response_model=schemas.InterfaceTemplateOut)
def update_template_interface(template_id: int, iface_id: int, payload: schemas.InterfaceTemplateUpdate,
                               db: Session = Depends(get_db), user: models.User = Depends(auth.can_edit)):
    """Поправить название или разъём порта модели.

    Правка разъезжается по всем устройствам этой модели: порт устройства —
    копия порта модели, и если подпись поменялась в модели, а на железках
    осталась прежней, одинаковые коммутаторы разъедутся по названиям портов
    — ровно то, ради чего состав портов и задаётся моделью.

    Порты, заведённые руками на устройстве со съёмными картами, не трогаются:
    у них своё название и свой разъём, в модели их нет.
    """
    iface = db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.id == iface_id, models.InterfaceTemplate.template_id == template_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Порт шаблона не найден")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return iface
    if data.get("connector_id") is not None and not db.get(models.ConnectorType, data["connector_id"]):
        raise HTTPException(status_code=404, detail="Разъём не найден")

    for field, value in data.items():
        setattr(iface, field, value)

    # Порты устройств находятся по ссылке на порт модели, а не по номеру:
    # у устройства со съёмными картами номера могли сомкнуться после снятой
    # карты, и правка попадала бы в соседний порт.
    touched = db.query(models.Interface).filter(
        models.Interface.template_interface_id == iface.id,
    ).update(data, synchronize_session=False)

    log_change(db, user.id, "update", "device_template", template_id,
               old=None, new={"порт": f"№{iface.port_number}", **data, "устройств затронуто": touched})
    db.commit()
    db.refresh(iface)
    return iface


@router.post("/{template_id}/copy", response_model=schemas.DeviceTemplateOut, status_code=201)
def copy_template(template_id: int, db: Session = Depends(get_db),
                   user: models.User = Depends(auth.can_edit)):
    """Копия модели со всеми портами.

    «Такой же коммутатор, но на 48 портов» иначе набивается заново, а
    отличается от исходного он одной строкой.
    """
    template = (
        db.query(models.DeviceTemplate)
        .options(joinedload(models.DeviceTemplate.interfaces))
        .filter(models.DeviceTemplate.id == template_id)
        .first()
    )
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон устройства не найден")

    name = f"{template.name} (копия)"
    suffix = 2
    while db.query(models.DeviceTemplate).filter(models.DeviceTemplate.name == name).first():
        name = f"{template.name} (копия {suffix})"
        suffix += 1

    copy = models.DeviceTemplate(
        name=name,
        device_type_id=template.device_type_id,
        manufacturer=template.manufacturer,
        notes=template.notes,
        color=template.color,
        ports_editable_on_device=template.ports_editable_on_device,
    )
    db.add(copy)
    db.flush()
    for port in template.interfaces:
        db.add(models.InterfaceTemplate(
            template_id=copy.id, port_number=port.port_number,
            label=port.label, connector_id=port.connector_id,
        ))

    log_change(db, user.id, "create", "device_template", None, old=None, new=copy)
    db.commit()
    db.refresh(copy)
    return copy


@router.delete("/{template_id}/interfaces/{iface_id}", status_code=204)
def delete_template_interface(template_id: int, iface_id: int, db: Session = Depends(get_db),
                               user: models.User = Depends(auth.can_edit)):
    """Убрать порт из модели — и у всех её экземпляров.

    Связи при этом НЕ удаляются: кабель физически остаётся проложенным, у
    него просто повисает конец. Подключить его заново можно к другому порту
    (POST /links/{id}/attach).

    Оставшиеся порты перенумеровываются: ряд гнёзд сплошной, дырка в нём
    означала бы гнездо, которого нет.
    """
    iface = db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.id == iface_id, models.InterfaceTemplate.template_id == template_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Порт шаблона не найден")

    device_ids = [d.id for d in db.query(models.Device).filter(models.Device.template_id == template_id).all()]
    removed = 0
    if device_ids:
        doomed = [
            row.id for row in db.query(models.Interface).filter(
                models.Interface.template_interface_id == iface.id,
            ).all()
        ]
        if doomed:
            # Кабель, у которого не остаётся ни одного конца, удаляется
            # целиком: подвешивать нечего, а запись без концов база не
            # примет. Так бывает, когда двумя концами он воткнут в порты с
            # одним номером (два одинаковых устройства соединены между
            # собой) или когда второй конец повис ещё раньше.
            cables.drop_cables_without_ends(db, doomed)

            removed = db.query(models.Interface).filter(
                models.Interface.id.in_(doomed),
            ).delete(synchronize_session=False)

    log_change(db, user.id, "update", "device_template", template_id,
               old={"убран порт": f"№{iface.port_number} {iface.label}", "устройств затронуто": removed}, new=None)
    db.delete(iface)
    ports.renumber(db, models.InterfaceTemplate, "template_id", template_id)
    ports.renumber(db, models.Interface, "device_id", device_ids)
    db.commit()


@router.get("/{template_id}/impact", response_model=schemas.TemplateImpact)
def template_impact(template_id: int, db: Session = Depends(get_db)):
    """Сколько устройств и связей заденет правка портов этой модели.

    Нужно, чтобы интерфейс мог предупредить до нажатия, а не после:
    убранный порт оставляет подвешенные концы у всех экземпляров сразу.
    """
    device_ids = [d.id for d in db.query(models.Device).filter(models.Device.template_id == template_id).all()]
    if not device_ids:
        return schemas.TemplateImpact(devices=0, connected_ports=0)

    interface_ids = [
        i.id for i in db.query(models.Interface).filter(models.Interface.device_id.in_(device_ids)).all()
    ]
    connected = 0
    if interface_ids:
        connected = db.query(models.Link).filter(
            or_(
                models.Link.interface_a_id.in_(interface_ids),
                models.Link.interface_b_id.in_(interface_ids),
            )
        ).count()
    return schemas.TemplateImpact(devices=len(device_ids), connected_ports=connected)
