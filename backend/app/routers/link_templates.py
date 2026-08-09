from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth
from app.audit import log_change

router = APIRouter(prefix="/link-templates", tags=["link-templates"])


@router.get("", response_model=list[schemas.LinkTemplateOut])
def list_link_templates(db: Session = Depends(get_db)):
    return db.query(models.LinkTemplate).order_by(models.LinkTemplate.name).all()


@router.post("", response_model=schemas.LinkTemplateOut, status_code=201)
def create_link_template(payload: schemas.LinkTemplateCreate, db: Session = Depends(get_db),
                          user: models.User = Depends(auth.can_edit)):
    if db.query(models.LinkTemplate).filter(models.LinkTemplate.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Шаблон связи с таким названием уже существует")
    template = models.LinkTemplate(**payload.model_dump())
    db.add(template)
    db.flush()
    log_change(db, user.id, "create", "link_template", template.id, old=None, new=template)
    db.commit()
    db.refresh(template)
    return template


@router.patch("/{template_id}", response_model=schemas.LinkTemplateOut)
def update_link_template(template_id: int, payload: schemas.LinkTemplateUpdate, db: Session = Depends(get_db),
                          user: models.User = Depends(auth.can_edit)):
    template = db.query(models.LinkTemplate).filter(models.LinkTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон связи не найден")
    old = {c.name: getattr(template, c.name) for c in template.__table__.columns}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    log_change(db, user.id, "update", "link_template", template.id, old=old, new=template)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=204)
def delete_link_template(template_id: int, db: Session = Depends(get_db),
                          user: models.User = Depends(auth.can_edit)):
    template = db.query(models.LinkTemplate).filter(models.LinkTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон связи не найден")
    # у links.template_id стоит ON DELETE SET NULL — существующие связи не пострадают,
    # просто останутся без шаблона (без цвета/стиля на топологии)
    log_change(db, user.id, "delete", "link_template", template.id,
               old={c.name: getattr(template, c.name) for c in template.__table__.columns}, new=None)
    db.delete(template)
    db.commit()
