"""Настройки, которые меняет администратор, а не разработчик.

Отличие от `app/config.py`: там — переменные окружения, читаются один раз
при старте контейнера, правка требует перезапуска. Здесь — таблицы с
единственной строкой, правятся через интерфейс на ходу: политика паролей и
адрес принтера этикеток. Один файл-роутер под все «настройки», а не по
одному на каждую мелочь — но каждая настройка в своей таблице: общая у них
только форма хранения, не содержание.
"""

from fastapi import APIRouter, Depends

from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models, password_policy, printer_settings, schemas, versioning
from app.audit import log_change

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/password-policy", response_model=schemas.PasswordPolicyOut)
def read_password_policy(db: Session = Depends(get_db),
                          _: models.User = Depends(auth.get_current_user)):
    """Доступна любой роли, не только админу: экран входа и смены пароля
    подсказывает требуемую длину до того, как человек её нарушит, и это
    не более чувствительная информация, чем сама форма."""
    return password_policy.get_policy(db)


@router.patch("/password-policy", response_model=schemas.PasswordPolicyOut)
def update_password_policy(payload: schemas.PasswordPolicyUpdate, db: Session = Depends(get_db),
                            admin: models.User = Depends(auth.can_admin)):
    policy = password_policy.get_policy(db)
    versioning.check(policy, payload.version)
    data = payload.model_dump(exclude_unset=True, exclude={"version"})
    old = {"min_length": policy.min_length, "max_age_days": policy.max_age_days}
    changed = versioning.differs(policy, data)
    for field, value in data.items():
        setattr(policy, field, value)
    if changed:
        versioning.bump(policy)
    log_change(db, admin.id, "update", "password_policy", policy.id, old=old, new=data)
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


@router.get("/printer", response_model=schemas.PrinterSettingsOut)
def read_printer_settings(db: Session = Depends(get_db),
                           _: models.User = Depends(auth.get_current_user)):
    """Доступна любой роли: адрес принтера в заводской сети — не секрет, а
    экран карточки устройства должен уметь показать «принтер не настроен»,
    не будучи админом."""
    return printer_settings.get_settings(db)


@router.patch("/printer", response_model=schemas.PrinterSettingsOut)
def update_printer_settings(payload: schemas.PrinterSettingsUpdate, db: Session = Depends(get_db),
                             admin: models.User = Depends(auth.can_admin)):
    settings = printer_settings.get_settings(db)
    versioning.check(settings, payload.version)
    data = payload.model_dump(exclude_unset=True, exclude={"version"})
    old = {"host": settings.host, "port": settings.port}
    changed = versioning.differs(settings, data)
    for field, value in data.items():
        setattr(settings, field, value)
    if changed:
        versioning.bump(settings)
    log_change(db, admin.id, "update", "printer_settings", settings.id, old=old, new=data)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings
