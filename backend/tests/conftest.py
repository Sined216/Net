"""Общие фикстуры тестов.

База — настоящий PostgreSQL, а не SQLite: модели используют типы, которых в
SQLite нет (ARRAY, а после этапа 0.4 — INET/CIDR/MACADDR), и проверять
поведение на другом диалекте бессмысленно.

Переменные окружения выставляются ДО импорта приложения: `app.database`
создаёт engine, а `app.auth` читает SECRET_KEY на уровне модуля.
"""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

os.environ.setdefault(
    "DATABASE_URL",
    os.getenv("TEST_DATABASE_URL", "postgresql://netdoc:netdoc@localhost:5432/netdoc_test"),
)
os.environ.setdefault("SECRET_KEY", "test-secret-key")
# Жёстко, а не setdefault: запуск pytest из корня репозитория подхватывает
# .env развёртывания с ENVIRONMENT=production, и проверка продовой
# конфигурации валит весь прогон на тестовом ключе. Тесты всегда идут в
# режиме разработки — продовые проверки покрыты отдельно в test_config.py.
os.environ["ENVIRONMENT"] = "development"

from app import auth, models  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.db_upgrade import upgrade_database  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "test-password-123"
_PASSWORD_HASH: str | None = None


def password_hash() -> str:
    """Argon2 намеренно медленный, поэтому хешируем один раз на весь прогон."""
    global _PASSWORD_HASH
    if _PASSWORD_HASH is None:
        _PASSWORD_HASH = auth.hash_password(PASSWORD)
    return _PASSWORD_HASH


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Схема создаётся миграциями, а не create_all: так каждый прогон
    заодно проверяет, что миграции применяются и дают ровно ту схему, на
    которую рассчитывают модели."""
    _drop_everything()
    upgrade_database()
    yield
    _drop_everything()


def _drop_everything():
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.fixture(autouse=True)
def _clean_tables():
    """Чистим перед тестом, а не после: если тест упал, состояние базы
    остаётся доступным для разбора. RESTART IDENTITY — чтобы коды устройств
    и id были предсказуемыми в каждом тесте."""
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    """TestClient намеренно не как контекстный менеджер: иначе отработает
    startup-хук приложения (create_all + сидирование справочников и админа),
    а тестам нужна чистая база и свои фикстуры."""
    return TestClient(app)


@pytest.fixture
def users(db):
    created = {}
    for role in ("admin", "editor", "viewer"):
        user = models.User(
            full_name=role.capitalize(), username=role,
            password_hash=password_hash(), role=role,
        )
        db.add(user)
        created[role] = user
    db.commit()
    for user in created.values():
        db.refresh(user)
    return created


@pytest.fixture
def headers(users):
    """Заголовки авторизации по ролям: headers["editor"] и т.п."""
    return {
        role: {"Authorization": f"Bearer {auth.create_access_token({'sub': str(u.id), 'role': u.role})}"}
        for role, u in users.items()
    }


@pytest.fixture
def device_type(db):
    dt = models.DeviceType(name="Коммутатор", code_prefix="SW")
    db.add(dt)
    db.commit()
    db.refresh(dt)
    return dt


@pytest.fixture
def template(db, device_type):
    """Шаблон на два порта — минимум, чтобы проверять копирование портов
    в устройство и создание связей между двумя устройствами."""
    tpl = models.DeviceTemplate(name="Тестовый коммутатор", device_type_id=device_type.id)
    db.add(tpl)
    db.flush()
    for n in (1, 2):
        db.add(models.InterfaceTemplate(template_id=tpl.id, label=f"Порт {n}", port_number=n))
    db.commit()
    db.refresh(tpl)
    return tpl


@pytest.fixture
def make_device(client, headers, template):
    """Создаёт устройство через API и возвращает его тело ответа."""
    def _make(**overrides):
        payload = {"template_id": template.id, **overrides}
        response = client.post("/devices", json=payload, headers=headers["editor"])
        assert response.status_code == 201, response.text
        return response.json()
    return _make
