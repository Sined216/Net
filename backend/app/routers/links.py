from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app import models, schemas, auth
from app.audit import log_change

router = APIRouter(prefix="/links", tags=["links"])


@router.get("", response_model=list[schemas.LinkOut])
def list_links(db: Session = Depends(get_db)):
    return db.query(models.Link).order_by(models.Link.id).all()


@router.post("", response_model=schemas.LinkOut, status_code=201)
def create_link(payload: schemas.LinkCreate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_edit)):
    a_id, b_id = payload.interface_a_id, payload.interface_b_id
    if a_id == b_id:
        raise HTTPException(status_code=400, detail="Нельзя соединить интерфейс сам с собой")
    if a_id > b_id:
        a_id, b_id = b_id, a_id

    iface_a = db.query(models.Interface).filter(models.Interface.id == a_id).first()
    iface_b = db.query(models.Interface).filter(models.Interface.id == b_id).first()
    if not iface_a or not iface_b:
        raise HTTPException(status_code=404, detail="Один из интерфейсов не найден")

    busy = db.query(models.Link).filter(
        or_(
            models.Link.interface_a_id.in_([a_id, b_id]),
            models.Link.interface_b_id.in_([a_id, b_id]),
        )
    ).first()
    if busy:
        raise HTTPException(status_code=409, detail="Один из интерфейсов уже занят другой связью")

    data = payload.model_dump()
    data["interface_a_id"] = a_id
    data["interface_b_id"] = b_id
    link = models.Link(**data, updated_by=user.id)
    db.add(link)

    # синхронизируем статус портов
    iface_a.status = "up"
    iface_b.status = "up"

    log_change(db, user.id, "create", "link", None, old=None, new=link)
    db.commit()
    db.refresh(link)
    return link


@router.patch("/{link_id}", response_model=schemas.LinkOut)
def update_link(link_id: int, payload: schemas.LinkUpdate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_edit)):
    link = db.query(models.Link).filter(models.Link.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")

    old_snapshot = {c.name: getattr(link, c.name) for c in link.__table__.columns}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(link, field, value)
    link.updated_by = user.id

    log_change(db, user.id, "update", "link", link.id, old=old_snapshot, new=link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/{link_id}", status_code=204)
def delete_link(link_id: int, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_edit)):
    link = db.query(models.Link).filter(models.Link.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Связь не найдена")

    old_snapshot = {c.name: getattr(link, c.name) for c in link.__table__.columns}
    # освобождаем порты
    for iface_id in (link.interface_a_id, link.interface_b_id):
        iface = db.query(models.Interface).filter(models.Interface.id == iface_id).first()
        if iface:
            iface.status = "free"

    log_change(db, user.id, "delete", "link", link.id, old=old_snapshot, new=None)
    db.delete(link)
    db.commit()
