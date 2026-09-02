"""Требование к длине пароля — читается из базы, а не из схемы.

`schemas.Password` не несёт `min_length`: pydantic вычисляет ограничения
поля один раз при импорте модуля и не может на каждый запрос заглядывать
в базу за текущей политикой. Поэтому длина проверяется здесь, обработчиком,
уже после разбора тела запроса, — единственное место, которое это делает,
чтобы `POST /auth/users`, `POST /auth/me/password` и
`POST /auth/users/{id}/password` не разошлись в требовании.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app import models

# Тот же дефолт, что несёт миграция 0024. Используется, только если строка
# политики почему-то не создалась, — подстраховка, а не рабочий путь.
DEFAULT_MIN_LENGTH = 12


def get_policy(db: Session) -> models.PasswordPolicy:
    policy = db.get(models.PasswordPolicy, 1)
    if policy is not None:
        return policy
    return models.PasswordPolicy(id=1, min_length=DEFAULT_MIN_LENGTH, max_age_days=None, version=1)


def length_error(db: Session, password: str) -> str | None:
    """`None` — пароль подходит по длине. Иначе — текст для 422, с точным
    числом из текущей политики, а не с зашитым когда-то «12»."""
    policy = get_policy(db)
    if len(password) < policy.min_length:
        return f"Пароль короче {policy.min_length} символов"
    return None


def is_expired(db: Session, user: models.User) -> bool:
    """Тот же расчёт, что у `auth.require_password_not_expired` — вынесен
    сюда, чтобы `/auth/me` мог заранее сказать фронтенду «пароль устарел»,
    не дожидаясь первого запроса, упавшего 403-й."""
    policy = get_policy(db)
    if policy.max_age_days is None or user.password_changed_at is None:
        return False
    age_days = (datetime.now(timezone.utc) - user.password_changed_at).days
    return age_days >= policy.max_age_days
