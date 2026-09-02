"""Политика паролей: минимальная длина и срок действия, настраиваемые
администратором, а не зашитые в код.

Значения по умолчанию (12 символов, без срока) совпадают с прежним
жёстко заданным поведением — существующие тесты (`test_users.py`) не
трогаются и должны продолжать проходить без единой правки.
"""

from datetime import datetime, timedelta, timezone


def test_default_policy_matches_previous_behavior(client, headers):
    """До первой правки администратором — ровно то, что раньше было
    зашито в схеме: 12 символов, без принудительной смены по сроку."""
    response = client.get("/settings/password-policy", headers=headers["viewer"])
    assert response.status_code == 200
    body = response.json()
    assert body["min_length"] == 12
    assert body["max_age_days"] is None


def test_policy_readable_by_any_role(client, headers):
    """Не только админ: форма входа и смены пароля должна знать требуемую
    длину заранее, а её открывает любая роль."""
    for role in ("admin", "editor", "viewer"):
        assert client.get("/settings/password-policy", headers=headers[role]).status_code == 200


def test_non_admin_cannot_change_policy(client, headers):
    for role in ("editor", "viewer"):
        response = client.patch("/settings/password-policy", json={"min_length": 20}, headers=headers[role])
        assert response.status_code == 403


def test_admin_changes_min_length(client, headers):
    response = client.patch("/settings/password-policy", json={"min_length": 20}, headers=headers["admin"])
    assert response.status_code == 200
    assert response.json()["min_length"] == 20

    again = client.get("/settings/password-policy", headers=headers["viewer"]).json()
    assert again["min_length"] == 20


def test_new_min_length_applies_to_new_passwords(client, headers):
    """Не только к тому, что видно в настройках, — к самой проверке при
    создании и смене пароля, той же ручкой, что раньше проверяла зашитые 12."""
    client.patch("/settings/password-policy", json={"min_length": 20}, headers=headers["admin"])

    short_but_used_to_pass = "пароль-в-16-симв"  # длиннее 12, короче 20
    assert 12 < len(short_but_used_to_pass) < 20

    response = client.post(
        "/auth/users",
        json={"full_name": "Новый", "username": "newbie", "password": short_but_used_to_pass, "role": "viewer"},
        headers=headers["admin"],
    )
    assert response.status_code == 422
    assert "20" in response.json()["detail"]

    long_enough = short_but_used_to_pass + "-ещё-длиннее"
    ok = client.post(
        "/auth/users",
        json={"full_name": "Новый", "username": "newbie", "password": long_enough, "role": "viewer"},
        headers=headers["admin"],
    )
    assert ok.status_code == 201


def test_policy_update_conflict_is_rejected(client, headers):
    """Тот же приём, что и у остальных настраиваемых сущностей
    (см. test_optimistic_locking.py): второй, кто сохраняет устаревший
    номер правки, получает 409, а не молча затирает первого."""
    first = client.get("/settings/password-policy", headers=headers["admin"]).json()
    stale_version = first["version"]

    client.patch("/settings/password-policy", json={"min_length": 16, "version": stale_version},
                 headers=headers["admin"])

    late = client.patch("/settings/password-policy", json={"min_length": 18, "version": stale_version},
                        headers=headers["admin"])
    assert late.status_code == 409


def test_no_expiry_by_default_however_old(client, headers, users, db):
    """`max_age_days` не задан — пароль не устаревает никогда, каким бы
    старым ни был `password_changed_at`."""
    editor = users["editor"]
    editor.password_changed_at = datetime.now(timezone.utc) - timedelta(days=3650)
    db.commit()

    assert client.get("/devices", headers=headers["editor"]).status_code == 200


def test_password_older_than_policy_forces_change(client, headers, users, db):
    client.patch("/settings/password-policy", json={"max_age_days": 30}, headers=headers["admin"])

    editor = users["editor"]
    editor.password_changed_at = datetime.now(timezone.utc) - timedelta(days=31)
    db.commit()

    response = client.get("/devices", headers=headers["editor"])
    assert response.status_code == 403
    assert "устарел" in response.json()["detail"]

    # Тот же путь наружу, что и у временного пароля.
    assert "/auth/me/password" in response.json()["detail"]


def test_password_policy_still_readable_with_expired_password(client, headers, users, db):
    """Форма смены пароля должна суметь показать требуемую длину и в этом
    случае — иначе человеку с устаревшим паролем нечем открыть саму форму."""
    client.patch("/settings/password-policy", json={"max_age_days": 1}, headers=headers["admin"])

    viewer = users["viewer"]
    viewer.password_changed_at = datetime.now(timezone.utc) - timedelta(days=2)
    db.commit()

    assert client.get("/devices", headers=headers["viewer"]).status_code == 403
    assert client.get("/settings/password-policy", headers=headers["viewer"]).status_code == 200


def test_password_not_yet_past_max_age_is_fine(client, headers, users, db):
    client.patch("/settings/password-policy", json={"max_age_days": 30}, headers=headers["admin"])

    editor = users["editor"]
    editor.password_changed_at = datetime.now(timezone.utc) - timedelta(days=29)
    db.commit()

    assert client.get("/devices", headers=headers["editor"]).status_code == 200


def test_changing_password_resets_the_age_clock(client, headers, users, db):
    from tests.conftest import PASSWORD

    client.patch("/settings/password-policy", json={"max_age_days": 30}, headers=headers["admin"])
    viewer = users["viewer"]
    viewer.password_changed_at = datetime.now(timezone.utc) - timedelta(days=31)
    db.commit()
    assert client.get("/devices", headers=headers["viewer"]).status_code == 403

    changed = client.post(
        "/auth/me/password",
        json={"current_password": PASSWORD, "new_password": "новый-длинный-пароль-номер-два"},
        headers=headers["viewer"],
    )
    assert changed.status_code == 200
    assert client.get("/devices", headers=headers["viewer"]).status_code == 200


def test_clearing_max_age_days_lifts_expiry(client, headers, users, db):
    """`max_age_days: null` явно снимает срок — не то же самое, что «поле не
    прислали»."""
    client.patch("/settings/password-policy", json={"max_age_days": 1}, headers=headers["admin"])
    editor = users["editor"]
    editor.password_changed_at = datetime.now(timezone.utc) - timedelta(days=2)
    db.commit()
    assert client.get("/devices", headers=headers["editor"]).status_code == 403

    cleared = client.patch("/settings/password-policy", json={"max_age_days": None}, headers=headers["admin"])
    assert cleared.status_code == 200
    assert cleared.json()["max_age_days"] is None
    assert client.get("/devices", headers=headers["editor"]).status_code == 200


def test_reset_by_admin_also_resets_age_clock(client, headers, users, db):
    client.patch("/settings/password-policy", json={"max_age_days": 30}, headers=headers["admin"])
    editor = users["editor"]
    editor.password_changed_at = datetime.now(timezone.utc) - timedelta(days=31)
    db.commit()

    reset = client.post("/auth/users/%d/password" % editor.id, json={"new_password": "administratorom-vydan"},
                        headers=headers["admin"])
    assert reset.status_code == 200
    db.refresh(editor)
    assert (datetime.now(timezone.utc) - editor.password_changed_at).total_seconds() < 5
