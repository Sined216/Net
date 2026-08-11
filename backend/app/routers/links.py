from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, select

from app.database import get_db
from app import models, schemas, auth, serialize, sites, versioning
from app.audit import log_change

router = APIRouter(prefix="/links", tags=["links"])


def _busy(db: Session, interface_ids: list[int], exclude_link_id: int | None = None) -> bool:
    """Порт участвует не более чем в одной связи — в том числе если второй
    её конец подвешен: кабель-то в порт воткнут."""
    q = db.query(models.Link).filter(
        or_(
            models.Link.interface_a_id.in_(interface_ids),
            models.Link.interface_b_id.in_(interface_ids),
        )
    )
    if exclude_link_id is not None:
        q = q.filter(models.Link.id != exclude_link_id)
    return q.first() is not None


@router.get("", response_model=schemas.LinkPage)
def list_links(device_id: int | None = None, dangling: bool | None = None,
                limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0),
                db: Session = Depends(get_db), site_id: int = Depends(sites.current_site_id)):
    """Кабели — страницами и сразу с подписями концов."""
    query = db.query(models.Link).filter(models.Link.site_id == site_id)
    if device_id is not None:
        ends = select(models.Interface.id).where(models.Interface.device_id == device_id)
        query = query.filter(or_(models.Link.interface_a_id.in_(ends),
                                 models.Link.interface_b_id.in_(ends)))
    if dangling is not None:
        empty = or_(models.Link.interface_a_id.is_(None), models.Link.interface_b_id.is_(None))
        query = query.filter(empty if dangling else ~empty)

    total = query.count()
    links = query.order_by(models.Link.id).limit(limit).offset(offset).all()
    return schemas.LinkPage(items=serialize.serialize_links(db, links), total=total)


@router.post("", response_model=schemas.LinkOut, status_code=201)
def create_link(payload: schemas.LinkCreate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_edit),
                 site_id: int = Depends(sites.current_site_id)):
    a_id, b_id = payload.interface_a_id, payload.interface_b_id
    if a_id == b_id:
        raise HTTPException(status_code=400, detail="Нельзя соединить интерфейс сам с собой")
    if a_id > b_id:
        a_id, b_id = b_id, a_id

    # Порт чужой площадки для этого запроса просто не существует. База такую
    # связь и так не запишет (составной ключ), но отвечать невнятной 500 на
    # ошибку в клиенте незачем.
    iface_a = db.query(models.Interface).filter(
        models.Interface.id == a_id, models.Interface.site_id == site_id
    ).first()
    iface_b = db.query(models.Interface).filter(
        models.Interface.id == b_id, models.Interface.site_id == site_id
    ).first()
    if not iface_a or not iface_b:
        raise HTTPException(status_code=404, detail="Один из интерфейсов не найден")

    if payload.template_id is not None:
        if not db.query(models.LinkTemplate).filter(models.LinkTemplate.id == payload.template_id).first():
            raise HTTPException(status_code=404, detail="Шаблон связи не найден")

    if _busy(db, [a_id, b_id]):
        raise HTTPException(status_code=409, detail="Один из интерфейсов уже занят другой связью")

    data = payload.model_dump()
    data["interface_a_id"] = a_id
    data["interface_b_id"] = b_id
    # source/confirmed выставляет сервер, а не клиент: связь, заведённая
    # через API руками, — всегда ручная и сразу подтверждённая.
    link = models.Link(**data, site_id=site_id, source="manual", confirmed=True, updated_by=user.id)
    db.add(link)
    db.flush()

    log_change(db, user.id, "create", "link", link.id, old=None, new=link)
    db.commit()
    db.refresh(link)
    return serialize.serialize_links(db, [link])[0]


@router.get("/{link_id}", response_model=schemas.LinkOut)
def get_link(link_id: int, db: Session = Depends(get_db),
              site_id: int = Depends(sites.current_site_id)):
    """Один кабель целиком — для окна его правки.

    Схема связей больше не возит страницу кабелей ради того, чтобы найти в
    ней тот, по которому щёлкнули: ей достаточно линий, а окно открывается
    по одной железке за раз.
    """
    link = db.query(models.Link).filter(
        models.Link.id == link_id, models.Link.site_id == site_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")
    return serialize.serialize_links(db, [link])[0]


@router.patch("/{link_id}", response_model=schemas.LinkOut)
def update_link(link_id: int, payload: schemas.LinkUpdate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_edit),
                 site_id: int = Depends(sites.current_site_id)):
    link = db.query(models.Link).filter(
        models.Link.id == link_id, models.Link.site_id == site_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")

    versioning.check(link, payload.version)
    data = payload.model_dump(exclude_unset=True, exclude={"version"})
    if data.get("template_id") is not None:
        if not db.query(models.LinkTemplate).filter(models.LinkTemplate.id == data["template_id"]).first():
            raise HTTPException(status_code=404, detail="Шаблон связи не найден")

    old_snapshot = {c.name: getattr(link, c.name) for c in link.__table__.columns}
    changed = versioning.differs(link, data)
    for field, value in data.items():
        setattr(link, field, value)
    link.updated_by = user.id
    if changed:
        versioning.bump(link)

    log_change(db, user.id, "update", "link", link.id, old=old_snapshot, new=link)
    db.commit()
    db.refresh(link)
    return serialize.serialize_links(db, [link])[0]


@router.post("/{link_id}/attach", response_model=schemas.LinkOut)
def attach_link_end(link_id: int, payload: schemas.LinkAttach, db: Session = Depends(get_db),
                    user: models.User = Depends(auth.can_edit),
                    site_id: int = Depends(sites.current_site_id)):
    """Подключить подвешенный конец связи к порту.

    Сценарий: с ПК сняли сетевую карту — порт исчез, кабель остался и повис.
    Поставили новую карту, завели порт — тем же кабелем подключаемся в него,
    не заводя связь заново и не теряя её длину, разъём и заметки.
    """
    link = db.query(models.Link).filter(
        models.Link.id == link_id, models.Link.site_id == site_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")
    if link.interface_a_id is not None and link.interface_b_id is not None:
        raise HTTPException(status_code=409, detail="У этой связи оба конца уже подключены")

    iface = db.query(models.Interface).filter(
        models.Interface.id == payload.interface_id, models.Interface.site_id == site_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")

    other_id = link.interface_a_id if link.interface_a_id is not None else link.interface_b_id
    if other_id == iface.id:
        raise HTTPException(status_code=400, detail="Нельзя соединить интерфейс сам с собой")
    if _busy(db, [iface.id], exclude_link_id=link.id):
        raise HTTPException(status_code=409, detail="Этот порт уже занят другой связью")

    old_snapshot = {c.name: getattr(link, c.name) for c in link.__table__.columns}
    # Стороны хранятся по возрастанию id — иначе не пройдёт ограничение базы.
    link.interface_a_id, link.interface_b_id = sorted([other_id, iface.id])
    link.updated_by = user.id
    versioning.bump(link)

    log_change(db, user.id, "update", "link", link.id, old=old_snapshot, new=link)
    db.commit()
    db.refresh(link)
    return serialize.serialize_links(db, [link])[0]


@router.post("/{link_id}/reconnect", response_model=schemas.LinkOut)
def reconnect_link_end(link_id: int, payload: schemas.LinkReconnect, db: Session = Depends(get_db),
                        user: models.User = Depends(auth.can_edit),
                        site_id: int = Depends(sites.current_site_id)):
    """Переставить конец кабеля в другой порт.

    Сценарий: кабель записали не в тот порт, или железку перекоммутировали в
    соседнее гнездо. Кабель тот же самый — у него та же длина, разъём и
    заметки, — поэтому связь не пересоздаётся: переезжает один её конец.

    От `attach` отличается тем, что здесь конец не подвешен, а сидит в
    порту: `attach` подключает потерянный конец, `reconnect` переставляет
    рабочий.
    """
    link = db.query(models.Link).filter(
        models.Link.id == link_id, models.Link.site_id == site_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")

    ends = [link.interface_a_id, link.interface_b_id]
    if payload.from_interface_id not in ends:
        raise HTTPException(status_code=400, detail="Этот порт не является концом связи")
    if payload.from_interface_id == payload.to_interface_id:
        return serialize.serialize_links(db, [link])[0]

    iface = db.query(models.Interface).filter(
        models.Interface.id == payload.to_interface_id, models.Interface.site_id == site_id
    ).first()
    if not iface:
        raise HTTPException(status_code=404, detail="Интерфейс не найден")

    other_id = ends[1] if ends[0] == payload.from_interface_id else ends[0]
    if other_id == iface.id:
        raise HTTPException(status_code=400, detail="Нельзя соединить интерфейс сам с собой")
    if _busy(db, [iface.id], exclude_link_id=link.id):
        raise HTTPException(status_code=409, detail="Этот порт уже занят другой связью")

    old_snapshot = {c.name: getattr(link, c.name) for c in link.__table__.columns}
    if other_id is None:
        # Второй конец подвешен: занятой стороной остаётся только новая.
        link.interface_a_id, link.interface_b_id = iface.id, None
    else:
        # Стороны хранятся по возрастанию id — иначе не пройдёт ограничение базы.
        link.interface_a_id, link.interface_b_id = sorted([other_id, iface.id])
    link.updated_by = user.id
    versioning.bump(link)

    log_change(db, user.id, "update", "link", link.id, old=old_snapshot, new=link)
    db.commit()
    db.refresh(link)
    return serialize.serialize_links(db, [link])[0]


@router.delete("/{link_id}", status_code=204)
def delete_link(link_id: int, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_edit),
                 site_id: int = Depends(sites.current_site_id)):
    link = db.query(models.Link).filter(
        models.Link.id == link_id, models.Link.site_id == site_id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")

    old_snapshot = {c.name: getattr(link, c.name) for c in link.__table__.columns}
    # порты снова станут "свободными" сами по себе — статус вычисляется
    # по наличию связи, отдельно ничего освобождать не нужно.
    # Это единственный способ убрать подвешенную связь целиком.
    log_change(db, user.id, "delete", "link", link.id, old=old_snapshot, new=None)
    db.delete(link)
    db.commit()
