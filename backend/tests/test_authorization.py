"""Ни один прикладной эндпоинт не отвечает без токена.

Тест обходит все маршруты приложения целиком, а не перечисляет их руками:
исходная дыра была именно в том, что защиту навешивали по одному хендлеру и
про GET-ы просто забыли. Новый эндпоинт, добавленный без авторизации, тут же
уронит этот тест.
"""

import pytest
from fastapi.routing import APIRoute

from app.main import app

# Открыты осознанно: вход (иначе токен негде взять) и проба живости для
# контейнера/балансировщика.
PUBLIC_ROUTES = {
    ("POST", "/auth/login"),
    ("GET", "/health"),
}

SKIPPED_METHODS = {"HEAD", "OPTIONS"}


def _sample_url(path: str) -> str:
    """Подставляет заглушку вместо параметров пути: до работы с базой дело
    не дойдёт, ответ должен быть 401 раньше."""
    result = []
    for part in path.split("/"):
        result.append("1" if part.startswith("{") and part.endswith("}") else part)
    return "/".join(result)


def _application_routes():
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods - SKIPPED_METHODS:
            if (method, route.path) in PUBLIC_ROUTES:
                continue
            yield method, route.path


@pytest.mark.parametrize("method,path", sorted(_application_routes()))
def test_endpoint_requires_authentication(client, method, path):
    response = client.request(method, _sample_url(path))
    assert response.status_code == 401, (
        f"{method} {path} отвечает без токена ({response.status_code})"
    )


def test_public_routes_stay_open(client):
    assert client.get("/health").status_code == 200
    # Неверные учётные данные — 401, но не 403 и не 422: форма входа доступна.
    assert client.post("/auth/login", data={"username": "нет", "password": "нет"}).status_code == 401


def test_read_endpoints_work_with_token(client, headers):
    for path in ("/devices", "/links", "/tags", "/vlans", "/device-types",
                 "/device-templates", "/link-templates", "/topology-groups"):
        assert client.get(path, headers=headers["viewer"]).status_code == 200, path


def test_search_requires_token(client, headers):
    assert client.get("/search", params={"query": "10.10"}).status_code == 401
    assert client.get("/search", params={"query": "10.10"}, headers=headers["viewer"]).status_code == 200


def test_topology_requires_token(client, headers):
    assert client.get("/topology").status_code == 401
    assert client.get("/topology", headers=headers["viewer"]).status_code == 200
