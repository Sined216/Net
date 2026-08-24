"""Ограничение перебора паролей.

Вход не был ограничен ничем: пароль к учётной записи администратора
подбирался скриптом за вечер. Периметр внутренний, но «внутренняя сеть» и
«доверенная сеть» — не одно и то же.

Насовсем учётная запись не запирается никогда: иначе достаточно поколотить
чужой логин, чтобы человек не смог работать.
"""

from datetime import datetime, timedelta, timezone

from app import auth, models
from tests.conftest import PASSWORD


def try_login(client, username: str, password: str):
    return client.post("/auth/login", data={"username": username, "password": password})


def test_wrong_password_is_counted(client, users, db):
    user = users["editor"]
    for _ in range(3):
        assert try_login(client, user.username, "неверный-пароль").status_code == 401

    db.refresh(user)
    assert user.failed_logins == 3
    assert user.locked_until is None, "до порога вход остаётся открытым"


def test_login_is_paused_after_too_many_attempts(client, users, db):
    user = users["editor"]
    for _ in range(auth.FREE_ATTEMPTS + 1):
        try_login(client, user.username, "неверный-пароль")

    response = try_login(client, user.username, "неверный-пароль")
    assert response.status_code == 429
    assert "попыток входа" in response.json()["detail"]
    assert int(response.headers["Retry-After"]) > 0

    db.refresh(user)
    assert user.locked_until is not None


def test_pause_grows_with_each_attempt(client, users, db):
    """Каждый следующий промах отодвигает вход вдвое — и упирается в потолок."""
    user = users["editor"]
    waits = []
    for _ in range(auth.FREE_ATTEMPTS + 3):
        try_login(client, user.username, "неверный-пароль")
        db.refresh(user)
        # Пауза считается от «сейчас», поэтому снимаем её сразу же.
        if user.locked_until is not None:
            waits.append(auth.lock_seconds_left(user))
            user.locked_until = None
            db.commit()

    assert waits == sorted(waits), "пауза не должна укорачиваться"
    assert waits[-1] <= auth.MAX_LOCK_SECONDS
    assert waits[0] >= auth.FIRST_LOCK_SECONDS - 1


def test_correct_password_clears_the_counter(client, users, db):
    user = users["editor"]
    for _ in range(3):
        try_login(client, user.username, "неверный-пароль")

    assert try_login(client, user.username, PASSWORD).status_code == 200
    db.refresh(user)
    assert user.failed_logins == 0
    assert user.locked_until is None


def test_pause_ends_by_itself(client, users, db):
    """Блокировка временная: её снимает время, а не администратор."""
    user = users["editor"]
    for _ in range(auth.FREE_ATTEMPTS + 1):
        try_login(client, user.username, "неверный-пароль")
    assert try_login(client, user.username, PASSWORD).status_code == 429

    user.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()
    assert try_login(client, user.username, PASSWORD).status_code == 200


def test_unknown_username_is_not_counted(client, db):
    """Счётчик на выдуманное имя — это мусор от любого сканера, а подобрать
    пароль всё равно можно только к существующей учётной записи."""
    before = db.query(models.User).count()
    for _ in range(auth.FREE_ATTEMPTS + 3):
        assert try_login(client, "нет-такого-логина", "пароль").status_code == 401
    assert db.query(models.User).count() == before


def test_other_users_are_not_affected(client, users):
    """Заперт один логин, а не вход вообще."""
    for _ in range(auth.FREE_ATTEMPTS + 1):
        try_login(client, users["editor"].username, "неверный-пароль")

    assert try_login(client, users["editor"].username, PASSWORD).status_code == 429
    assert try_login(client, users["admin"].username, PASSWORD).status_code == 200
