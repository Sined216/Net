from datetime import datetime, timedelta, timezone
from typing import Optional, List

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHash
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app import models

SECRET_KEY = settings.secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes

# Argon2id — текущая рекомендация OWASP для хранения паролей (устойчив к
# перебору на GPU/ASIC за счёт требований к памяти). Пришёл на смену
# passlib+bcrypt: passlib не обновлялся с 2020 года и конфликтует с новыми
# версиями bcrypt.
ph = PasswordHasher()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


# Сколько промахов подряд прощается и как быстро растёт пауза. Пять — это
# заметно больше, чем опечатки живого человека, и заметно меньше, чем нужно
# перебору: после них каждая следующая попытка отодвигает вход вдвое, до
# получаса. Насовсем не запирает никогда — иначе достаточно поколотить чужой
# логин, чтобы человек не смог войти вовсе.
FREE_ATTEMPTS = 5
FIRST_LOCK_SECONDS = 60
MAX_LOCK_SECONDS = 30 * 60


def hash_password(password: str) -> str:
    return ph.hash(password)


def lock_seconds_left(user: models.User) -> int:
    """Сколько ещё ждать этой учётной записи. 0 — вход открыт."""
    if user.locked_until is None:
        return 0
    left = (user.locked_until - datetime.now(timezone.utc)).total_seconds()
    return max(0, int(left + 0.999))


def register_failed_login(db: Session, user: models.User) -> None:
    """Промах: счётчик растёт, и после порога вход закрывается на паузу.

    Считается по учётной записи, а не по адресу: адрес в локальной сети
    меняется одной командой, а перебор идёт по конкретному логину.
    """
    user.failed_logins = (user.failed_logins or 0) + 1
    over = user.failed_logins - FREE_ATTEMPTS
    if over > 0:
        seconds = min(FIRST_LOCK_SECONDS * (2 ** (over - 1)), MAX_LOCK_SECONDS)
        user.locked_until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    db.commit()


def reset_failed_logins(db: Session, user: models.User) -> None:
    """Удачный вход стирает историю промахов: они шли не от подбора."""
    if user.failed_logins or user.locked_until:
        user.failed_logins = 0
        user.locked_until = None
        db.commit()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return ph.verify(hashed, plain)
    except (VerificationError, InvalidHash):
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось подтвердить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except jwt.PyJWTError:
        # from None: подробности разбора токена наружу не отдаём и в трассу
        # не тянем — клиенту достаточно 401.
        raise credentials_exception from None

    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        # Блокировка должна действовать немедленно, а не по истечении уже
        # выданного токена: проверяем на каждом запросе, а не при входе.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Учётная запись заблокирована",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_password_changed(user: models.User = Depends(get_current_user)) -> models.User:
    """Тот же пользователь, что и `get_current_user`, — плюс ещё одна
    проверка: пароль, назначенный не самим человеком (первый вход, сброс
    администратором), не должен пускать никуда, кроме смены пароля.

    Раньше это проверял только браузер — модалкой без крестика, — а сам
    токен, выданный по временному паролю, оставался при этом полноценным:
    им можно было год работать через API или Swagger, ни разу пароль не
    сменив. Роутеры, кроме `auth_router`, подключаются с этой проверкой
    вместо голого `get_current_user` (см. `main.py`) — `/auth/me` и
    `/auth/me/password` её не несут специально, иначе сменить временный
    пароль стало бы нечем.
    """
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Сначала смените пароль — POST /auth/me/password",
        )
    return user


def require_password_not_expired(
    user: models.User = Depends(require_password_changed),
    db: Session = Depends(get_db),
) -> models.User:
    """Вторая причина потребовать новый пароль — не «его назначили не вы»,
    а «этому уже слишком много дней». Срок настраивается администратором
    (`PasswordPolicy.max_age_days`, см. `app/password_policy.py`); `NULL`
    значит, что срока нет, и эта проверка ничего не делает.

    Композиция та же, что у `require_password_changed`: строится поверх
    него, а не рядом, — так `must_change_password` проверяется первым и не
    даёт двух разных 403 за один запрос.
    """
    from app import password_policy  # локальный импорт: без цикла auth ↔ password_policy

    if password_policy.is_expired(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Пароль устарел — смените его: POST /auth/me/password",
        )
    return user


def require_role(allowed_roles: List[str]):
    # `require_password_not_expired`, а не голый `get_current_user`: без
    # этого админ с временным или устаревшим паролем мог бы через
    # `/auth/users/*` управлять чужими учётными записями, ни разу не сменив
    # собственный, — эти маршруты живут в `auth_router`, который не
    # проходит через общую проверку роутеров в `main.py`.
    def checker(user: models.User = Depends(require_password_not_expired)) -> models.User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Требуется роль: {', '.join(allowed_roles)}",
            )
        return user
    return checker


# editor и admin могут писать, viewer - только читать
can_edit = require_role(["admin", "editor"])
can_admin = require_role(["admin"])
