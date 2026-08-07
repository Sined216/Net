from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth

router = APIRouter(prefix="/topology-groups", tags=["topology-groups"])


@router.get("", response_model=list[schemas.TopologyGroupOut])
def list_topology_groups(db: Session = Depends(get_db)):
    return db.query(models.TopologyGroup).order_by(models.TopologyGroup.name).all()


@router.post("", response_model=schemas.TopologyGroupOut, status_code=201)
def create_topology_group(payload: schemas.TopologyGroupCreate, db: Session = Depends(get_db),
                           _: models.User = Depends(auth.can_edit)):
    if db.query(models.TopologyGroup).filter(models.TopologyGroup.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Группа с таким названием уже существует")
    group = models.TopologyGroup(**payload.model_dump())
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.patch("/{group_id}", response_model=schemas.TopologyGroupOut)
def update_topology_group(group_id: int, payload: schemas.TopologyGroupUpdate, db: Session = Depends(get_db),
                           _: models.User = Depends(auth.can_edit)):
    group = db.query(models.TopologyGroup).filter(models.TopologyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{group_id}", status_code=204)
def delete_topology_group(group_id: int, db: Session = Depends(get_db),
                           _: models.User = Depends(auth.can_edit)):
    group = db.query(models.TopologyGroup).filter(models.TopologyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    # у устройств этой группы topology_group_id просто станет NULL (ON DELETE SET NULL)
    db.delete(group)
    db.commit()
