from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth

router = APIRouter(prefix="/tags", tags=["tags"])


def _same_parent_exists(db: Session, name: str, parent_id: int | None, exclude_id: int | None = None) -> bool:
    q = db.query(models.Tag).filter(models.Tag.name == name)
    q = q.filter(models.Tag.parent_id == parent_id) if parent_id is not None else q.filter(models.Tag.parent_id.is_(None))
    if exclude_id is not None:
        q = q.filter(models.Tag.id != exclude_id)
    return q.first() is not None


def _is_descendant(db: Session, tag_id: int, maybe_ancestor_id: int) -> bool:
    """Проверка цикла: не станет ли tag_id сам себе (пра)родителем."""
    node = db.query(models.Tag).filter(models.Tag.id == maybe_ancestor_id).first()
    while node is not None:
        if node.id == tag_id:
            return True
        node = db.query(models.Tag).filter(models.Tag.id == node.parent_id).first() if node.parent_id else None
    return False


@router.get("", response_model=list[schemas.TagOut])
def list_tags(db: Session = Depends(get_db)):
    return db.query(models.Tag).order_by(models.Tag.name).all()


@router.post("", response_model=schemas.TagOut, status_code=201)
def create_tag(payload: schemas.TagCreate, db: Session = Depends(get_db),
                _: models.User = Depends(auth.can_edit)):
    if payload.parent_id is not None and not db.query(models.Tag).filter(models.Tag.id == payload.parent_id).first():
        raise HTTPException(status_code=404, detail="Родительский тег не найден")
    if _same_parent_exists(db, payload.name, payload.parent_id):
        raise HTTPException(status_code=409, detail="У этого родителя уже есть тег с таким названием")
    tag = models.Tag(**payload.model_dump())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.patch("/{tag_id}", response_model=schemas.TagOut)
def update_tag(tag_id: int, payload: schemas.TagUpdate, db: Session = Depends(get_db),
                _: models.User = Depends(auth.can_edit)):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")

    data = payload.model_dump(exclude_unset=True)
    new_parent_id = data.get("parent_id", tag.parent_id)
    if new_parent_id is not None:
        if new_parent_id == tag_id:
            raise HTTPException(status_code=400, detail="Тег не может быть родителем самому себе")
        if not db.query(models.Tag).filter(models.Tag.id == new_parent_id).first():
            raise HTTPException(status_code=404, detail="Родительский тег не найден")
        if _is_descendant(db, tag_id, new_parent_id):
            raise HTTPException(status_code=400, detail="Нельзя сделать родителем собственного потомка (цикл)")
    new_name = data.get("name", tag.name)
    if _same_parent_exists(db, new_name, new_parent_id, exclude_id=tag_id):
        raise HTTPException(status_code=409, detail="У этого родителя уже есть тег с таким названием")

    for field, value in data.items():
        setattr(tag, field, value)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db),
                _: models.User = Depends(auth.can_edit)):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")
    # дочерние теги удалятся каскадом (parent_id ON DELETE CASCADE),
    # у устройств этот тег просто пропадёт из списка (M2M ON DELETE CASCADE)
    db.delete(tag)
    db.commit()
