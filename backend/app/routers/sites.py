from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[schemas.SiteOut])
def list_sites(db: Session = Depends(get_db)):
    return db.query(models.Site).order_by(models.Site.name).all()


@router.post("", response_model=schemas.SiteOut, status_code=201)
def create_site(payload: schemas.SiteCreate, db: Session = Depends(get_db),
                 _: models.User = Depends(auth.can_edit)):
    site = models.Site(**payload.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: int, db: Session = Depends(get_db),
                 _: models.User = Depends(auth.can_edit)):
    site = db.query(models.Site).get(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Площадка не найдена")
    db.delete(site)
    db.commit()
