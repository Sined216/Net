from tests.conftest import PASSWORD


def test_login_returns_token(client, users):
    response = client.post("/auth/login", data={"username": "editor", "password": PASSWORD})
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_login_with_wrong_password_is_rejected(client, users):
    response = client.post("/auth/login", data={"username": "editor", "password": "не тот пароль"})
    assert response.status_code == 401


def test_login_with_unknown_user_is_rejected(client, users):
    response = client.post("/auth/login", data={"username": "нет такого", "password": PASSWORD})
    assert response.status_code == 401


def test_me_returns_current_user(client, headers):
    response = client.get("/auth/me", headers=headers["viewer"])
    assert response.status_code == 200
    assert response.json()["username"] == "viewer"
    assert "password_hash" not in response.json()


def test_me_without_token_is_rejected(client):
    assert client.get("/auth/me").status_code == 401


def test_me_with_garbage_token_is_rejected(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


def test_only_admin_lists_users(client, headers):
    assert client.get("/auth/users", headers=headers["admin"]).status_code == 200
    assert client.get("/auth/users", headers=headers["editor"]).status_code == 403
    assert client.get("/auth/users", headers=headers["viewer"]).status_code == 403


def test_only_admin_creates_users(client, headers, site):
    payload = {
        "full_name": "Новый", "username": "newbie", "password": "какой-то-пароль",
        "role": "viewer", "site_ids": [site.id],
    }
    assert client.post("/auth/users", json=payload, headers=headers["editor"]).status_code == 403

    response = client.post("/auth/users", json=payload, headers=headers["admin"])
    assert response.status_code == 201
    assert response.json()["role"] == "viewer"


def test_duplicate_username_is_rejected(client, headers):
    payload = {"full_name": "Дубль", "username": "editor", "password": "какой-то-пароль"}
    response = client.post("/auth/users", json=payload, headers=headers["admin"])
    assert response.status_code == 409


def test_created_user_can_log_in(client, headers, site):
    client.post(
        "/auth/users",
        json={
            "full_name": "Новый", "username": "newbie", "password": "какой-то-пароль",
            "role": "editor", "site_ids": [site.id],
        },
        headers=headers["admin"],
    )
    response = client.post("/auth/login", data={"username": "newbie", "password": "какой-то-пароль"})
    assert response.status_code == 200
