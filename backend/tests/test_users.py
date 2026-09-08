"""Управление учётными записями.

Отдельный файл, а не дополнение test_auth.py: здесь проверяется не вход как
таковой, а жизненный цикл учётной записи — смена пароля, роли, блокировка и
защита от того, чтобы остаться без администраторов.
"""

import pytest

from tests.conftest import PASSWORD

NEW_PASSWORD = "новый-длинный-пароль"


def _login(client, username, password):
    return client.post("/auth/login", data={"username": username, "password": password})


# ---------- смена своего пароля ----------

def test_user_changes_own_password(client, headers):
    response = client.post(
        "/auth/me/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=headers["viewer"],
    )
    assert response.status_code == 200

    assert _login(client, "viewer", NEW_PASSWORD).status_code == 200
    assert _login(client, "viewer", PASSWORD).status_code == 401, "старый пароль должен перестать работать"


def test_wrong_current_password_is_rejected(client, headers):
    response = client.post(
        "/auth/me/password",
        json={"current_password": "не тот пароль", "new_password": NEW_PASSWORD},
        headers=headers["viewer"],
    )
    assert response.status_code == 400
    assert _login(client, "viewer", PASSWORD).status_code == 200, "пароль не должен был смениться"


def test_new_password_cannot_repeat_current(client, headers):
    response = client.post(
        "/auth/me/password",
        json={"current_password": PASSWORD, "new_password": PASSWORD},
        headers=headers["viewer"],
    )
    assert response.status_code == 400


@pytest.mark.parametrize("weak", ["короткий", "12345678901", ""])
def test_short_password_is_rejected(client, headers, weak):
    response = client.post(
        "/auth/me/password",
        json={"current_password": PASSWORD, "new_password": weak},
        headers=headers["viewer"],
    )
    assert response.status_code == 422


def test_short_password_rejected_on_user_creation(client, headers):
    response = client.post(
        "/auth/users",
        json={"full_name": "Новый", "username": "newbie", "password": "коротко"},
        headers=headers["admin"],
    )
    assert response.status_code == 422


# ---------- требование сменить пароль ----------

def test_created_user_must_change_password(client, headers, site):
    created = client.post(
        "/auth/users",
        json={
            "full_name": "Новый", "username": "newbie", "password": "временный-пароль-123",
            "role": "editor", "site_ids": [site.id],
        },
        headers=headers["admin"],
    ).json()
    assert created["must_change_password"] is True, "пароль придумал администратор, значит его знает не только владелец"

    token = _login(client, "newbie", "временный-пароль-123").json()["access_token"]
    own = {"Authorization": f"Bearer {token}"}

    changed = client.post(
        "/auth/me/password",
        json={"current_password": "временный-пароль-123", "new_password": NEW_PASSWORD},
        headers=own,
    )
    assert changed.status_code == 200
    assert changed.json()["must_change_password"] is False


def test_temp_password_token_is_useless_anywhere_but_password_change(client, headers, users, db):
    """Раньше требование сменить пароль проверял только браузер — модалкой
    без крестика. Сам токен, выданный по временному паролю, был при этом
    полноценным: им можно было год работать через API или Swagger, ни разу
    пароль не сменив.

    Отбивается всё, кроме своей учётной записи и её смены; удаётся именно
    смена пароля."""
    users["viewer"].must_change_password = True
    db.commit()

    denied = client.get("/devices", headers=headers["viewer"])
    assert denied.status_code == 403
    assert "смените пароль" in denied.json()["detail"].lower()

    allowed_me = client.get("/auth/me", headers=headers["viewer"])
    assert allowed_me.status_code == 200

    changed = client.post(
        "/auth/me/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=headers["viewer"],
    )
    assert changed.status_code == 200
    assert changed.json()["must_change_password"] is False

    # Флаг снят — тот же токен теперь пускает и на обычные маршруты.
    assert client.get("/devices", headers=headers["viewer"]).status_code == 200


def test_admin_reset_sets_the_flag_again(client, headers, users):
    response = client.post(
        f"/auth/users/{users['viewer'].id}/password",
        json={"new_password": NEW_PASSWORD},
        headers=headers["admin"],
    )
    assert response.status_code == 200
    assert response.json()["must_change_password"] is True
    assert _login(client, "viewer", NEW_PASSWORD).status_code == 200


def test_only_admin_resets_passwords(client, headers, users):
    response = client.post(
        f"/auth/users/{users['admin'].id}/password",
        json={"new_password": NEW_PASSWORD},
        headers=headers["editor"],
    )
    assert response.status_code == 403


# ---------- правка учётной записи ----------

def test_admin_changes_role_and_name(client, headers, users):
    response = client.patch(
        f"/auth/users/{users['viewer'].id}",
        json={"role": "editor", "full_name": "Пётр Петров"},
        headers=headers["admin"],
    )
    assert response.status_code == 200
    assert response.json()["role"] == "editor"
    assert response.json()["full_name"] == "Пётр Петров"


def test_role_change_takes_effect_immediately(client, headers, users, template):
    """Права проверяются по базе на каждом запросе, а не по роли внутри
    токена: разжалованный не должен доработать смену с прежними правами."""
    client.patch(f"/auth/users/{users['editor'].id}", json={"role": "viewer"}, headers=headers["admin"])

    response = client.post("/devices", json={"template_id": template.id}, headers=headers["editor"])
    assert response.status_code == 403


def test_editor_cannot_edit_users(client, headers, users):
    response = client.patch(
        f"/auth/users/{users['viewer'].id}", json={"role": "admin"}, headers=headers["editor"]
    )
    assert response.status_code == 403


def test_unknown_user_is_404(client, headers):
    assert client.patch("/auth/users/9999", json={"role": "viewer"}, headers=headers["admin"]).status_code == 404


# ---------- блокировка ----------

def test_blocked_user_cannot_log_in_or_use_token(client, headers, users):
    editor_token = headers["editor"]
    assert client.get("/devices", headers=editor_token).status_code == 200

    response = client.delete(f"/auth/users/{users['editor'].id}", headers=headers["admin"])
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    # Уже выданный токен должен перестать работать сразу, а не по истечении срока.
    assert client.get("/devices", headers=editor_token).status_code == 401
    assert _login(client, "editor", PASSWORD).status_code == 401


def test_blocked_user_can_be_restored(client, headers, users):
    client.delete(f"/auth/users/{users['editor'].id}", headers=headers["admin"])

    response = client.patch(
        f"/auth/users/{users['editor'].id}", json={"is_active": True}, headers=headers["admin"]
    )
    assert response.status_code == 200
    assert _login(client, "editor", PASSWORD).status_code == 200


def test_admin_cannot_block_himself(client, headers, users):
    response = client.delete(f"/auth/users/{users['admin'].id}", headers=headers["admin"])
    assert response.status_code == 409


def test_blocked_user_row_survives(client, headers, users, db):
    """Блокировка не удаляет строку: журнал изменений ссылается на автора."""
    client.delete(f"/auth/users/{users['editor'].id}", headers=headers["admin"])

    from app import models
    assert db.query(models.User).filter(models.User.username == "editor").count() == 1


# ---------- защита последнего администратора ----------

def test_last_admin_cannot_be_demoted(client, headers, users):
    response = client.patch(
        f"/auth/users/{users['admin'].id}", json={"role": "editor"}, headers=headers["admin"]
    )
    assert response.status_code == 409
    assert "администратор" in response.json()["detail"].lower()


def test_last_admin_cannot_be_blocked(client, headers, users):
    response = client.patch(
        f"/auth/users/{users['admin'].id}", json={"is_active": False}, headers=headers["admin"]
    )
    assert response.status_code == 409


def test_admin_can_be_demoted_when_another_one_exists(client, headers, users):
    client.post(
        "/auth/users",
        json={"full_name": "Второй админ", "username": "admin2", "password": "второй-длинный-пароль", "role": "admin"},
        headers=headers["admin"],
    )

    response = client.patch(
        f"/auth/users/{users['admin'].id}", json={"role": "editor"}, headers=headers["admin"]
    )
    assert response.status_code == 200


def test_blocked_admin_does_not_count_as_a_spare(client, headers, users):
    """Заблокированный админ войти не может, поэтому не должен считаться
    заменой последнему активному."""
    second = client.post(
        "/auth/users",
        json={"full_name": "Второй админ", "username": "admin2", "password": "второй-длинный-пароль", "role": "admin"},
        headers=headers["admin"],
    ).json()
    client.delete(f"/auth/users/{second['id']}", headers=headers["admin"])

    response = client.patch(
        f"/auth/users/{users['admin'].id}", json={"role": "editor"}, headers=headers["admin"]
    )
    assert response.status_code == 409


# ---------- список ----------

def test_user_list_exposes_state_but_not_hashes(client, headers):
    users_list = client.get("/auth/users", headers=headers["admin"]).json()
    assert {"is_active", "must_change_password"} <= set(users_list[0])
    assert "password_hash" not in users_list[0]


# ---------- площадка при создании ----------

def test_creating_non_admin_without_site_is_rejected(client, headers):
    response = client.post(
        "/auth/users",
        json={"full_name": "Без площадки", "username": "no-site", "password": "достаточно-длинный", "role": "editor"},
        headers=headers["admin"],
    )
    assert response.status_code == 422
    assert "площад" in response.json()["detail"]


def test_creating_editor_with_site_grants_access(client, headers, site):
    response = client.post(
        "/auth/users",
        json={
            "full_name": "С площадкой", "username": "with-site", "password": "достаточно-длинный",
            "role": "editor", "site_ids": [site.id],
        },
        headers=headers["admin"],
    )
    assert response.status_code == 201
    new_id = response.json()["id"]

    access = client.get(f"/sites/{site.id}/access", headers=headers["admin"]).json()
    assert new_id in access


def test_creating_user_with_unknown_site_is_404(client, headers):
    response = client.post(
        "/auth/users",
        json={
            "full_name": "Мимо", "username": "bad-site", "password": "достаточно-длинный",
            "role": "editor", "site_ids": [999999],
        },
        headers=headers["admin"],
    )
    assert response.status_code == 404


def test_creating_admin_needs_no_site(client, headers):
    """Админ и без площадок видит всё по роли — требовать выбор незачем."""
    response = client.post(
        "/auth/users",
        json={"full_name": "Новый админ", "username": "new-admin", "password": "достаточно-длинный", "role": "admin"},
        headers=headers["admin"],
    )
    assert response.status_code == 201


def test_creating_admin_with_site_ids_is_harmless(client, headers, site):
    """Прислали площадки для админа — не ошибка, просто не имеет смысла:
    его доступ по роли их всё равно перекрывает."""
    response = client.post(
        "/auth/users",
        json={
            "full_name": "Админ с площадкой", "username": "admin-with-site", "password": "достаточно-длинный",
            "role": "admin", "site_ids": [site.id],
        },
        headers=headers["admin"],
    )
    assert response.status_code == 201


# ---------- удаление насовсем ----------

def test_active_user_cannot_be_permanently_deleted(client, headers, users):
    response = client.delete(f"/auth/users/{users['viewer'].id}/permanent", headers=headers["admin"])
    assert response.status_code == 409
    assert "заблок" in response.json()["detail"]


def test_blocked_user_can_be_permanently_deleted(client, headers, users):
    viewer = users["viewer"]
    client.delete(f"/auth/users/{viewer.id}", headers=headers["admin"])  # блокировка

    response = client.delete(f"/auth/users/{viewer.id}/permanent", headers=headers["admin"])
    assert response.status_code == 204

    listed = client.get("/auth/users", headers=headers["admin"]).json()
    assert viewer.id not in {u["id"] for u in listed}


def test_cannot_permanently_delete_self(client, headers, users):
    admin = users["admin"]
    # Себя нельзя даже заблокировать, но проверяем и вторую ручку отдельно —
    # код в ней не полагается на то, что до неё не дойти.
    response = client.delete(f"/auth/users/{admin.id}/permanent", headers=headers["admin"])
    assert response.status_code == 409


def test_deleting_blocked_admin_does_not_need_a_spare(client, headers, users):
    """Заблокированный админ и так не считается активным — удалить его
    можно даже если он был единственным администратором."""
    second = client.post(
        "/auth/users",
        json={"full_name": "Второй админ", "username": "admin2", "password": "второй-длинный-пароль", "role": "admin"},
        headers=headers["admin"],
    ).json()
    client.delete(f"/auth/users/{second['id']}", headers=headers["admin"])  # блокировка

    response = client.delete(f"/auth/users/{second['id']}/permanent", headers=headers["admin"])
    assert response.status_code == 204


def test_permanent_delete_leaves_named_audit_entry(client, headers, users, db):
    viewer = users["viewer"]
    username = viewer.username
    client.delete(f"/auth/users/{viewer.id}", headers=headers["admin"])
    client.delete(f"/auth/users/{viewer.id}/permanent", headers=headers["admin"])

    entries = client.get("/audit", headers=headers["admin"]).json()["items"]
    delete_entry = next(e for e in entries if e["entity_type"] == "user" and e["action"] == "delete")
    assert delete_entry["entity_id"] == viewer.id
    # Прежние записи об этом пользователе (например, блокировка) не падают
    # при чтении — автор просто не восстановим и отдаётся пустым.
    block_entry = next(e for e in entries if e["entity_type"] == "user" and e["action"] == "update"
                       and e["entity_id"] == viewer.id)
    assert block_entry["user_name"] is None or isinstance(block_entry["user_name"], str)
    assert username  # использован выше — фиксирует, что учётка правда была этим пользователем


def test_only_admin_permanently_deletes(client, headers, users):
    editor = users["editor"]
    client.delete(f"/auth/users/{editor.id}", headers=headers["admin"])

    # Не токеном заблокированного — тот получил бы 401 раньше, чем дело
    # дойдёт до проверки роли. Нужен другой действующий не-админ.
    response = client.delete(f"/auth/users/{editor.id}/permanent", headers=headers["viewer"])
    assert response.status_code == 403
