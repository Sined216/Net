from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas, auth
from app.audit import log_change

router = APIRouter(prefix="/auth", tags=["auth"])


def _get_user(db: Session, user_id: int) -> models.User:
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return user


def _assert_not_last_admin(db: Session, user: models.User) -> None:
    """Не даём остаться без администраторов.

    Иначе достаточно одной опечатки — разжаловать себя или заблокировать
    единственного админа, — и управлять пользователями станет некому:
    восстанавливать пришлось бы правкой в базе руками.
    """
    if user.role != "admin" or not user.is_active:
        return
    other_admins = (
        db.query(models.User)
        .filter(
            models.User.role == "admin",
            models.User.is_active.is_(True),
            models.User.id != user.id,
        )
        .count()
    )
    if other_admins == 0:
        raise HTTPException(
            status_code=409,
            detail="Это последний активный администратор — сначала назначьте другого",
        )


@router.post("/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    if not user.is_active:
        # Тот же 401, что и при неверном пароле: заблокированному не нужно
        # подсказывать, что логин угадан верно.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    token = auth.create_access_token({"sub": str(user.id), "role": user.role})
    return schemas.Token(access_token=token)


@router.get("/me", response_model=schemas.UserOut)
def read_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@router.post("/me/password", response_model=schemas.UserOut)
def change_own_password(payload: schemas.PasswordChange, db: Session = Depends(get_db),
                        current_user: models.User = Depends(auth.get_current_user)):
    if not auth.verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="Новый пароль совпадает с текущим")

    current_user.password_hash = auth.hash_password(payload.new_password)
    current_user.must_change_password = False
    log_change(db, current_user.id, "update", "user", current_user.id,
               old={"password": "изменён"}, new=None)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db), _: models.User = Depends(auth.can_admin)):
    return db.query(models.User).order_by(models.User.id).all()


@router.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db),
                admin: models.User = Depends(auth.can_admin)):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
    user = models.User(
        full_name=payload.full_name,
        username=payload.username,
        password_hash=auth.hash_password(payload.password),
        role=payload.role,
        # Пароль придумал администратор, значит его знает не только владелец.
        must_change_password=True,
    )
    db.add(user)
    log_change(db, admin.id, "create", "user", None, old=None, new={"username": payload.username, "role": payload.role})
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: int, payload: schemas.UserUpdate, db: Session = Depends(get_db),
                admin: models.User = Depends(auth.can_admin)):
    user = _get_user(db, user_id)
    data = payload.model_dump(exclude_unset=True)

    losing_admin = (data.get("role") is not None and data["role"] != "admin") or data.get("is_active") is False
    if losing_admin:
        _assert_not_last_admin(db, user)

    old_snapshot = {"full_name": user.full_name, "role": user.role, "is_active": user.is_active}
    for field, value in data.items():
        setattr(user, field, value)

    log_change(db, admin.id, "update", "user", user.id, old=old_snapshot, new=data)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/password", response_model=schemas.UserOut)
def reset_user_password(user_id: int, payload: schemas.PasswordReset, db: Session = Depends(get_db),
                        admin: models.User = Depends(auth.can_admin)):
    user = _get_user(db, user_id)
    user.password_hash = auth.hash_password(payload.new_password)
    # Пароль назначен чужим человеком — владелец обязан сменить его при входе.
    user.must_change_password = True

    log_change(db, admin.id, "update", "user", user.id, old={"password": "сброшен администратором"}, new=None)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", response_model=schemas.UserOut)
def deactivate_user(user_id: int, db: Session = Depends(get_db),
                    admin: models.User = Depends(auth.can_admin)):
    """Блокировка, а не удаление строки.

    Журнал изменений ссылается на пользователя, и записи «кто менял связь»
    не должны терять автора при увольнении. Вернуть доступ можно через
    PATCH с is_active=true.
    """
    user = _get_user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=409, detail="Нельзя заблокировать самого себя")
    _assert_not_last_admin(db, user)

    user.is_active = False
    log_change(db, admin.id, "update", "user", user.id, old={"is_active": True}, new={"is_active": False})
    db.commit()
    db.refresh(user)
    return user
