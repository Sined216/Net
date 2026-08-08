"""Накат миграций на базу, созданную до подключения Alembic.

Самый опасный сценарий во всей задаче: у работающей установки таблицы уже
есть, а истории миграций нет. Накатить «с нуля» такую базу нельзя — первая
ревизия попыталась бы создать существующие таблицы. Проверяем весь путь
целиком, ровно так, как это делает контейнер: отдельным процессом с своим
DATABASE_URL.
"""

import os
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, text

from app.config import settings

LEGACY_DB = "netdoc_legacy_test"
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _url_for(database: str) -> str:
    base, _, _ = settings.database_url.rpartition("/")
    return f"{base}/{database}"


def _run(args, database):
    env = {**os.environ, "DATABASE_URL": _url_for(database), "SECRET_KEY": "test-secret-key"}
    result = subprocess.run(
        args, cwd=BACKEND_ROOT, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"{' '.join(args)}\n{result.stdout}\n{result.stderr}"
    return result


@pytest.fixture
def legacy_database():
    """Пустая база под этот тест. CREATE DATABASE не работает внутри
    транзакции, поэтому подключаемся в режиме автокоммита."""
    admin = create_engine(settings.database_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{LEGACY_DB}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{LEGACY_DB}"'))

    engine = create_engine(_url_for(LEGACY_DB))
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{LEGACY_DB}" WITH (FORCE)'))
        admin.dispose()


def _column_types(engine, pairs):
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name, column_name, udt_name
                FROM information_schema.columns
                WHERE (table_name, column_name) IN (
                    ('devices','management_ip'), ('devices','install_date'),
                    ('interfaces','ip'), ('interfaces','mac'), ('vlans','subnet')
                )
                """
            )
        ).all()
    return {(t, c): u for t, c, u in rows}


def test_existing_database_is_stamped_and_upgraded(legacy_database):
    engine = legacy_database

    # 1. Воспроизводим базу, какой её оставлял create_all: схема baseline,
    #    но без таблицы истории миграций.
    _run([sys.executable, "-m", "alembic", "upgrade", "0001_baseline"], LEGACY_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE alembic_version"))
        conn.execute(text("INSERT INTO device_types(name, code_prefix) VALUES ('Коммутатор','SW')"))
        conn.execute(text("INSERT INTO device_templates(name, device_type_id) VALUES ('Тестовый', 1)"))
        conn.execute(
            text(
                "INSERT INTO devices(template_id, code, name, management_ip, install_date) "
                "VALUES (1,'SW-0001','Старое устройство','10.10.1.2','2024-03-15')"
            )
        )
        # MAC записан «по-виндовому» — база при переводе в MACADDR приведёт
        # его к каноническому виду.
        conn.execute(
            text(
                "INSERT INTO interfaces(device_id, label, ip, mac) "
                "VALUES (1,'Порт 1','10.10.1.50','A4-BB-6D-11-22-33')"
            )
        )
        conn.execute(text("INSERT INTO vlans(vlan_number, subnet) VALUES (10,'10.10.1.0/24')"))

    types_before = _column_types(engine, None)
    assert types_before[("interfaces", "ip")] == "varchar"

    # 2. Ровно то, что делает контейнер перед запуском uvicorn.
    result = _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)
    assert "0001_baseline" in result.stderr, "существующая база должна быть помечена штампом, а не создана заново"

    # 3. Типы приведены к нативным.
    types_after = _column_types(engine, None)
    assert types_after == {
        ("devices", "management_ip"): "inet",
        ("devices", "install_date"): "date",
        ("interfaces", "ip"): "inet",
        ("interfaces", "mac"): "macaddr",
        ("vlans", "subnet"): "cidr",
    }

    # 4. Данные пережили преобразование, MAC нормализован.
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT d.code, d.management_ip::text, d.install_date::text, i.ip::text, i.mac::text "
                "FROM devices d JOIN interfaces i ON i.device_id = d.id"
            )
        ).one()
    assert row[0] == "SW-0001"
    assert row[1].startswith("10.10.1.2")
    assert row[2] == "2024-03-15"
    assert row[3].startswith("10.10.1.50")
    assert row[4] == "a4:bb:6d:11:22:33"


def _head_revision() -> str:
    """Последняя ревизия берётся из самих миграций, а не пишется в тесте:
    иначе каждая новая ревизия ломала бы этот тест на ровном месте."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(os.path.join(BACKEND_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_ROOT, "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()


def test_upgrade_is_idempotent(legacy_database):
    """Контейнер перезапускается часто — повторный накат не должен ничего
    ломать."""
    _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)
    _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)

    with legacy_database.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert version == _head_revision()


def test_fresh_database_gets_full_schema(legacy_database):
    """Пустая база накатывается с нуля — без всякого штампа."""
    _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)

    with legacy_database.connect() as conn:
        tables = {
            row[0]
            for row in conn.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
            )
        }
    assert {"users", "devices", "interfaces", "links", "tags", "audit_log"} <= tables
