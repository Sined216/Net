from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth, sites
from app.audit import log_change

router = APIRouter(prefix="/topology-groups", tags=["topology-groups"])

# Было 3 (цех — участок — линия) — не хватало на цех — участок — линию —
# шкаф и глубже. Глубже шести рамка внутри рамки внутри рамки уже нечитаема
# на глаз, а раскладка начинает съедать место под заголовки быстрее, чем
# остаётся под содержимое.
MAX_DEPTH = 6


def _depth(db: Session, group_id: int | None) -> int:
    """Сколько групп над этой, считая её саму."""
    depth = 0
    node = db.query(models.TopologyGroup).filter(models.TopologyGroup.id == group_id).first() if group_id else None
    while node is not None:
        depth += 1
        node = (
            db.query(models.TopologyGroup).filter(models.TopologyGroup.id == node.parent_id).first()
            if node.parent_id else None
        )
    return depth


def _is_descendant(db: Session, group_id: int, maybe_ancestor_id: int) -> bool:
    """Не станет ли группа сама себе (пра)родителем."""
    node = db.query(models.TopologyGroup).filter(models.TopologyGroup.id == maybe_ancestor_id).first()
    while node is not None:
        if node.id == group_id:
            return True
        node = (
            db.query(models.TopologyGroup).filter(models.TopologyGroup.id == node.parent_id).first()
            if node.parent_id else None
        )
    return False


def _subtree_depth(db: Session, group_id: int) -> int:
    """Насколько глубоко уходят подгруппы под этой (сама группа — 1)."""
    children = db.query(models.TopologyGroup).filter(models.TopologyGroup.parent_id == group_id).all()
    if not children:
        return 1
    return 1 + max(_subtree_depth(db, child.id) for child in children)


def _check_parent(db: Session, site_id: int, parent_id: int | None, group_id: int | None = None) -> None:
    if parent_id is None:
        return
    # Родитель — только своей площадки: рамка цеха одной фабрики не может
    # оказаться внутри рамки другой.
    parent = db.query(models.TopologyGroup).filter(
        models.TopologyGroup.id == parent_id, models.TopologyGroup.site_id == site_id
    ).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Родительская группа не найдена")
    # Шкаф — конец дерева: внутрь него кладут только устройства, подгруппа
    # там — ошибка ввода, а не законная вложенность.
    if parent.kind == "cabinet":
        raise HTTPException(status_code=400, detail="В шкаф нельзя вложить группу — это конец дерева")
    if group_id is not None:
        if parent_id == group_id:
            raise HTTPException(status_code=400, detail="Группа не может быть вложена сама в себя")
        if _is_descendant(db, group_id, parent_id):
            raise HTTPException(status_code=400, detail="Нельзя вложить группу в собственную подгруппу")
    # Перенос тащит за собой все подгруппы, поэтому считается высота поддерева.
    height = _subtree_depth(db, group_id) if group_id is not None else 1
    if _depth(db, parent_id) + height > MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail=f"Глубже {MAX_DEPTH} уровней вложенности группы не читаются на схеме",
        )


@router.get("", response_model=list[schemas.TopologyGroupOut])
def list_topology_groups(db: Session = Depends(get_db),
                          site_id: int = Depends(sites.current_site_id)):
    groups = (
        db.query(models.TopologyGroup)
        .filter(models.TopologyGroup.site_id == site_id)
        .order_by(models.TopologyGroup.name)
        .all()
    )
    # Количество устройств в группе считает база — одним запросом на весь
    # список. Раньше эту цифру выводил браузер, для чего ему приходилось
    # держать при себе все устройства площадки.
    counts = dict(
        db.query(models.Device.topology_group_id, func.count(models.Device.id))
        .filter(models.Device.site_id == site_id,
                models.Device.topology_group_id.isnot(None))
        .group_by(models.Device.topology_group_id)
        .all()
    )
    return [
        schemas.TopologyGroupOut.model_validate(g).model_copy(
            update={"device_count": counts.get(g.id, 0)}
        )
        for g in groups
    ]


@router.post("", response_model=schemas.TopologyGroupOut, status_code=201)
def create_topology_group(payload: schemas.TopologyGroupCreate, db: Session = Depends(get_db),
                           user: models.User = Depends(auth.can_edit),
                           site_id: int = Depends(sites.current_site_id)):
    if db.query(models.TopologyGroup).filter(
        models.TopologyGroup.name == payload.name, models.TopologyGroup.site_id == site_id
    ).first():
        raise HTTPException(status_code=409, detail="Группа с таким названием уже существует")
    _check_parent(db, site_id, payload.parent_id)
    group = models.TopologyGroup(site_id=site_id, **payload.model_dump())
    db.add(group)
    db.flush()
    log_change(db, user.id, "create", "topology_group", group.id, old=None, new=group)
    db.commit()
    db.refresh(group)
    return group


@router.patch("/{group_id}", response_model=schemas.TopologyGroupOut)
def update_topology_group(group_id: int, payload: schemas.TopologyGroupUpdate, db: Session = Depends(get_db),
                           user: models.User = Depends(auth.can_edit),
                           site_id: int = Depends(sites.current_site_id)):
    group = db.query(models.TopologyGroup).filter(
        models.TopologyGroup.id == group_id, models.TopologyGroup.site_id == site_id
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    data = payload.model_dump(exclude_unset=True)
    if "parent_id" in data:
        _check_parent(db, site_id, data["parent_id"], group_id)
    if data.get("kind") == "cabinet" and db.query(models.TopologyGroup).filter(
        models.TopologyGroup.parent_id == group_id
    ).first():
        raise HTTPException(
            status_code=400,
            detail="У шкафа не может быть подгрупп — сначала перенесите их или удалите",
        )
    if "name" in data and db.query(models.TopologyGroup).filter(
        models.TopologyGroup.name == data["name"], models.TopologyGroup.id != group_id,
        models.TopologyGroup.site_id == site_id,
    ).first():
        raise HTTPException(status_code=409, detail="Группа с таким названием уже существует")

    old = {c.name: getattr(group, c.name) for c in group.__table__.columns}
    for field, value in data.items():
        setattr(group, field, value)
    log_change(db, user.id, "update", "topology_group", group.id, old=old, new=group)
    db.commit()
    db.refresh(group)
    return group


@router.patch("/{group_id}/box", response_model=schemas.TopologyGroupOut)
def set_topology_group_box(group_id: int, payload: schemas.TopologyGroupBox, db: Session = Depends(get_db),
                            _: models.User = Depends(auth.can_edit),
                            site_id: int = Depends(sites.current_site_id)):
    """Куда сдвинули и до какого размера растянули рамку.

    Отдельно от общей правки: рамку двигают мышью часто, и в журнал
    изменений такие движения не пишутся — это оформление схемы, а не данные
    об оборудовании.
    """
    group = db.query(models.TopologyGroup).filter(
        models.TopologyGroup.id == group_id, models.TopologyGroup.site_id == site_id
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    group.x, group.y = payload.x, payload.y
    group.width, group.height = payload.width, payload.height
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=204)
def delete_topology_group(group_id: int, db: Session = Depends(get_db),
                           user: models.User = Depends(auth.can_edit),
                           site_id: int = Depends(sites.current_site_id)):
    group = db.query(models.TopologyGroup).filter(
        models.TopologyGroup.id == group_id, models.TopologyGroup.site_id == site_id
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    # У устройств этой группы topology_group_id станет NULL, а подгруппы
    # всплывут на уровень выше (обе связи — ON DELETE SET NULL).
    log_change(db, user.id, "delete", "topology_group", group.id,
               old={c.name: getattr(group, c.name) for c in group.__table__.columns}, new=None)
    db.delete(group)
    db.commit()
