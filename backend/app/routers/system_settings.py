"""Настройки, которые меняет администратор, а не разработчик.

Отличие от `app/config.py`: там — переменные окружения, читаются один раз
при старте контейнера, правка требует перезапуска. Здесь — таблицы с
единственной строкой, правятся через интерфейс на ходу. Первая — политика
паролей; со временем сюда же лягут настройки принтера этикеток и подобное
— один файл-роутер под все «настройки», а не по одному на каждую мелочь.
"""

from fastapi import APIRouter, Depends

from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models, password_policy, schemas, versioning
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
