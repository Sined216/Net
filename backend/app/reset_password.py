"""Восстановление доступа: посмотреть учётные записи и сменить пароль.

Пароль забывают, и это не редкость, а обычный вторник. До появления этого
модуля выхода было два: поднимать базу заново (вместе с ней теряя всю
документацию сети) или лезть в `users` руками и подставлять туда хеш —
операция, которую без подсказки не сделает никто.

Запускается там же, где живёт приложение, — в контейнере бэкенда:

    docker compose exec backend python -m app.reset_password --list
    docker compose exec backend python -m app.reset_password admin

Лежит в `app/`, а не в `backend/scripts/`, намеренно: `scripts/` в образ не
копируются, это инструменты разработки. Восстановление доступа нужно как раз
на работающей установке — рядом с `app/db_upgrade.py`, который запускается
так же.

Проверки прав здесь нет и быть не может: у того, кто выполняет команды на
сервере, доступ к базе и так полный. Смысл модуля не в разграничении, а в
том, чтобы не делать руками то, что легко сделать неправильно.
"""

import argparse
import getpass
import sys
from datetime import datetime, timezone

from app import auth, models, password_policy
from app.database import SessionLocal


def _state(user: models.User) -> str:
    """Почему именно этот вход не проходит — одной строкой."""
    notes = []
    if not user.is_active:
        notes.append("заблокирован")
    left = auth.lock_seconds_left(user)
    if left:
        notes.append(f"пауза после {user.failed_logins} неудачных попыток, ещё {left} с")
    elif user.failed_logins:
        notes.append(f"неудачных попыток подряд: {user.failed_logins}")
    if user.must_change_password:
        notes.append("потребуется сменить пароль при входе")
    return ", ".join(notes) or "вход открыт"


def list_users(db) -> int:
    users = db.query(models.User).order_by(models.User.id).all()
    if not users:
        print("Учётных записей нет вовсе. Перезапустите бэкенд — при пустой "
              "таблице он заводит администратора из BOOTSTRAP_ADMIN_PASSWORD.")
        return 0
    width = max(len(u.username) for u in users)
    print(f"{'логин'.ljust(width)}  роль      состояние")
    for user in users:
        print(f"{user.username.ljust(width)}  {user.role.ljust(8)}  {_state(user)}")
    return 0


def reset(db, username: str, password: str | None, activate: bool, keep_lock: bool) -> int:
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        known = ", ".join(u.username for u in db.query(models.User).all()) or "нет ни одной"
        print(f"Нет учётной записи «{username}». Есть такие: {known}", file=sys.stderr)
        return 1

    if not user.is_active and not activate:
        # Молча включать обратно нельзя: запись могли отключить намеренно —
        # человек уволился, а пароль ему меняют «на всякий случай».
        print(f"Учётная запись «{username}» заблокирована. Если её нужно включить, "
              f"добавьте --activate", file=sys.stderr)
        return 1

    if password is None:
        password = getpass.getpass("Новый пароль: ")
        if password != getpass.getpass("Ещё раз: "):
            print("Пароли не совпали", file=sys.stderr)
            return 1
    # Требование то же, что и в интерфейсе, и берётся из того же места —
    # текущей политики в базе, а не зашитого числа: пароль, который здесь
    # примут, а там отвергнут, только запутает.
    error = password_policy.length_error(db, password)
    if error:
        print(error, file=sys.stderr)
        return 1

    user.password_hash = auth.hash_password(password)
    user.password_changed_at = datetime.now(timezone.utc)
    # Пароль выбран сейчас и вручную — требовать сменить его при первом же
    # входе незачем, это тот самый пароль, который человек только что задал.
    user.must_change_password = False
    if activate:
        user.is_active = True
    if not keep_lock:
        user.failed_logins = 0
        user.locked_until = None
    db.commit()

    print(f"Пароль для «{username}» изменён. {_state(user)}")
    return 0


def unlock(db, username: str) -> int:
    """Снять паузу, не трогая пароль: пароль помнят, просто промахнулись
    подряд больше пяти раз."""
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        print(f"Нет учётной записи «{username}»", file=sys.stderr)
        return 1
    left = auth.lock_seconds_left(user)
    user.failed_logins = 0
    user.locked_until = None
    db.commit()
    print(f"Пауза для «{username}» снята" + (f" (оставалось {left} с)" if left else " (её и не было)"))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Посмотреть учётные записи и сменить пароль",
        epilog="Пример: docker compose exec backend python -m app.reset_password admin",
    )
    parser.add_argument("username", nargs="?", help="кому меняем пароль")
    parser.add_argument("--list", action="store_true", help="показать учётные записи и их состояние")
    parser.add_argument("--password", help="новый пароль; без него спросит и не покажет ввод")
    parser.add_argument("--activate", action="store_true", help="заодно снять блокировку учётной записи")
    parser.add_argument("--unlock", action="store_true",
                        help="только снять паузу после неудачных попыток, пароль не менять")
    parser.add_argument("--keep-lock", action="store_true",
                        help="не снимать паузу при смене пароля (нужно редко)")
    args = parser.parse_args()

    if not args.list and not args.username:
        parser.print_help()
        return 2

    db = SessionLocal()
    try:
        if args.list:
            return list_users(db)
        if args.unlock:
            return unlock(db, args.username)
        return reset(db, args.username, args.password, args.activate, args.keep_lock)
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
