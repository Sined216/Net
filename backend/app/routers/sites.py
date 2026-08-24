"""Площадки (фабрики) и доступ к ним.

Заводит и раздаёт площадки только администратор: это не рабочая настройка, а
разделение системы. Список доступных площадок читает любой — из него шапка
интерфейса собирает переключатель, и без него человек не смог бы работать
вовсе.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import auth, models, schemas, sites, versioning
from app.audit import log_change
from app.database import get_db

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[schemas.SiteOut])
def list_sites(db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    """Площадки, доступные этому человеку. Чужих в списке нет — их не должно
    быть видно даже по названию."""
    return sites.accessible_sites(db, user)


@router.post("", response_model=schemas.SiteOut, status_code=201)
def create_site(payload: schemas.SiteCreate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_admin)):
    if db.query(models.Site).filter(models.Site.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Площадка с таким названием уже есть")
    site = models.Site(**payload.model_dump())
    db.add(site)
    log_change(db, user.id, "create", "site", None, old=None, new=site)
    db.commit()
    db.refresh(site)
    return site


@router.patch("/{site_id}", response_model=schemas.SiteOut)
def update_site(site_id: int, payload: schemas.SiteUpdate, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_admin)):
    site = db.get(models.Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Площадка не найдена")
    versioning.check(site, payload.version)
    data = payload.model_dump(exclude_unset=True, exclude={"version"})
    old = {c.name: getattr(site, c.name) for c in site.__table__.columns}
    changed = versioning.differs(site, data)
    for field, value in data.items():
        setattr(site, field, value)
    if changed:
        versioning.bump(site)
    log_change(db, user.id, "update", "site", site.id, old=old, new=site)
    db.commit()
    db.refresh(site)
    return site


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: int, db: Session = Depends(get_db),
                 user: models.User = Depends(auth.can_admin)):
    """Удалить площадку вместе со всем, что на ней описано.

    Удаление уносит устройства, порты, кабели, теги, VLAN и группы этой
    площадки — на то она и изоляция. Поэтому непустую площадку удалить
    нельзя: сначала разберитесь с оборудованием, иначе одно нажатие стирает
    всю фабрику.
    """
    site = db.get(models.Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Площадка не найдена")
    devices = db.query(models.Device).filter(models.Device.site_id == site_id).count()
    if devices:
        raise HTTPException(
            status_code=409,
            detail=f"На площадке заведено устройств: {devices}. Удалите их, прежде чем удалять площадку",
        )
    if db.query(models.Site).count() == 1:
        raise HTTPException(status_code=409, detail="Это единственная площадка — без неё работать не с чем")

    old = {c.name: getattr(site, c.name) for c in site.__table__.columns}
    log_change(db, user.id, "delete", "site", site.id, old=old, new=None)
    db.delete(site)
    db.commit()


@router.get("/{site_id}/access", response_model=list[int])
def list_site_access(site_id: int, db: Session = Depends(get_db),
                     _: models.User = Depends(auth.can_admin)):
    """Кому назначена площадка. Администраторы в списке не участвуют: им
    доступны все площадки по роли."""
    if not db.get(models.Site, site_id):
        raise HTTPException(status_code=404, detail="Площадка не найдена")
    rows = db.execute(
        models.user_sites.select().where(models.user_sites.c.site_id == site_id)
    ).all()
    return [row.user_id for row in rows]


@router.put("/{site_id}/access", response_model=list[int])
def set_site_access(site_id: int, payload: schemas.SiteAccessUpdate, db: Session = Depends(get_db),
                    user: models.User = Depends(auth.can_admin)):
    if not db.get(models.Site, site_id):
        raise HTTPException(status_code=404, detail="Площадка не найдена")
    wanted = sorted(set(payload.user_ids))
    if wanted:
        found = db.query(models.User.id).filter(models.User.id.in_(wanted)).count()
        if found != len(wanted):
            raise HTTPException(status_code=404, detail="Один из пользователей не найден")

    db.execute(models.user_sites.delete().where(models.user_sites.c.site_id == site_id))
    for user_id in wanted:
        db.execute(models.user_sites.insert().values(user_id=user_id, site_id=site_id))
    log_change(db, user.id, "update", "site", site_id, old=None, new={"доступ": wanted})
    db.commit()
    return wanted
