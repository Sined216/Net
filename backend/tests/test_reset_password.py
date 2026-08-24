"""Восстановление доступа с консоли.

Инструментом пользуются ровно тогда, когда в систему не войти, — проверить
его в этот момент уже нечем. Поэтому он проверяется здесь: сломайся он
молча, узнали бы об этом в худший из возможных дней.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app import auth, models
from app.reset_password import list_users, reset, unlock

GOOD_PASSWORD = "novyj-parol-nadolgo"


@pytest.fixture
def locked_admin(db, users):
    """Администратор, который шесть раз подряд промахнулся мимо пароля."""
    admin = db.query(models.User).filter(models.User.role == "admin").first()
    admin.failed_logins = 6
    admin.locked_until = datetime.now(timezone.utc) + timedelta(seconds=120)
    db.commit()
    return admin


def test_reset_lets_the_person_back_in(db, users, locked_admin, capsys):
    """Главное: после сброса пароль подходит, а пауза снята."""
    assert reset(db, locked_admin.username, GOOD_PASSWORD, activate=False, keep_lock=False) == 0

    db.refresh(locked_admin)
    assert auth.verify_password(GOOD_PASSWORD, locked_admin.password_hash)
    assert auth.lock_seconds_left(locked_admin) == 0
    assert locked_admin.failed_logins == 0
    # Пароль только что выбран руками — требовать сменить его при входе
    # незачем.
    assert locked_admin.must_change_password is False
    assert "изменён" in capsys.readouterr().out


def test_short_password_is_refused(db, users, capsys):
    """Требование то же, что и в интерфейсе: пароль, принятый здесь и
    отвергнутый там, только запутает."""
    admin = db.query(models.User).filter(models.User.role == "admin").first()
    was = admin.password_hash

    assert reset(db, admin.username, "korotko", activate=False, keep_lock=False) == 1

    db.refresh(admin)
    assert admin.password_hash == was, "пароль не должен был поменяться"


def test_unknown_login_lists_the_real_ones(db, users, capsys):
    """Ошиблись в логине — подсказываем, какие есть: угадывать его с
    консоли, когда войти нельзя, особенно неприятно."""
    assert reset(db, "petrov", GOOD_PASSWORD, activate=False, keep_lock=False) == 1
    assert "petrov" in capsys.readouterr().err


def test_disabled_account_is_not_switched_on_quietly(db, users, capsys):
    """Запись могли отключить намеренно — человек уволился. Смена пароля не
    повод включать её обратно, но и молчать об этом нельзя."""
    admin = db.query(models.User).filter(models.User.role == "admin").first()
    admin.is_active = False
    db.commit()

    assert reset(db, admin.username, GOOD_PASSWORD, activate=False, keep_lock=False) == 1
    db.refresh(admin)
    assert admin.is_active is False
    assert "--activate" in capsys.readouterr().err

    assert reset(db, admin.username, GOOD_PASSWORD, activate=True, keep_lock=False) == 0
    db.refresh(admin)
    assert admin.is_active is True


def test_unlock_leaves_the_password_alone(db, users, locked_admin, capsys):
    """Пароль помнят, просто промахнулись подряд — менять его незачем."""
    was = locked_admin.password_hash

    assert unlock(db, locked_admin.username) == 0

    db.refresh(locked_admin)
    assert locked_admin.password_hash == was
    assert auth.lock_seconds_left(locked_admin) == 0


def test_list_shows_why_the_login_fails(db, users, locked_admin, capsys):
    """Список нужен, чтобы понять причину, а не просто перечислить логины."""
    assert list_users(db) == 0
    printed = capsys.readouterr().out
    assert locked_admin.username in printed
    assert "пауза" in printed
