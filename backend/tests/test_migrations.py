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


def test_existing_data_lands_on_one_site(legacy_database):
    """Накат площадок на уже наполненную базу.

    Устройства, порты, кабели, теги и VLAN обязаны уехать на одну общую
    площадку — иначе после обновления система встретит человека пустыми
    списками, и разбирать, что где, придётся руками. Доступ к ней получают
    все заведённые люди: до обновления они видели всё.
    """
    engine = legacy_database
    _run([sys.executable, "-m", "alembic", "upgrade", "0001_baseline"], LEGACY_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE alembic_version"))
        conn.execute(text("INSERT INTO device_types(name, code_prefix) VALUES ('Коммутатор','SW')"))
        conn.execute(text("INSERT INTO device_templates(name, device_type_id) VALUES ('Тестовый', 1)"))
        conn.execute(text("INSERT INTO devices(template_id, code) VALUES (1,'SW-0001')"))
        conn.execute(text("INSERT INTO interfaces(device_id, label) VALUES (1,'Порт 1')"))
        conn.execute(text("INSERT INTO vlans(vlan_number) VALUES (10)"))
        conn.execute(text("INSERT INTO tags(name) VALUES ('Цех 1')"))
        conn.execute(text(
            "INSERT INTO users(full_name, username, password_hash, role) "
            "VALUES ('Мастер','master','x','editor')"
        ))

    _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)

    with engine.connect() as conn:
        sites = conn.execute(text("SELECT id, name FROM sites")).all()
        assert len(sites) == 1, "площадка должна быть ровно одна"
        site_id = sites[0][0]
        for table in ("devices", "interfaces", "vlans", "tags"):
            rows = conn.execute(text(f"SELECT count(*) FROM {table} WHERE site_id = :s"),
                                {"s": site_id}).scalar_one()
            assert rows == 1, f"{table}: данные не уехали на площадку"
        granted = conn.execute(text(
            "SELECT count(*) FROM user_sites u JOIN users x ON x.id = u.user_id WHERE x.username = 'master'"
        )).scalar_one()
        assert granted == 1, "у заведённого человека должен остаться доступ"


def test_duplicate_port_numbers_are_resolved(legacy_database):
    """Номера портов до этой ревизии ничего не значили: их можно было не
    ставить вовсе и можно было поставить один и тот же дважды. Накат на
    такую базу обязан развести конфликты сам — иначе бэкенд не поднимется."""
    engine = legacy_database
    _run([sys.executable, "-m", "alembic", "upgrade", "0005_dangling_ends"], LEGACY_DB)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO device_types(name, code_prefix) VALUES ('Коммутатор','SW')"))
        conn.execute(text("INSERT INTO device_templates(name, device_type_id) VALUES ('Тестовый', 1)"))
        # Два порта модели с одинаковым номером и один вовсе без номера.
        conn.execute(
            text(
                "INSERT INTO device_template_interfaces(template_id, label, port_number) "
                "VALUES (1,'Порт A',4), (1,'Порт B',4), (1,'Порт C',NULL)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO devices(template_id, code, name) VALUES (1,'SW-0001','Старое устройство')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO interfaces(device_id, label, port_number) "
                "VALUES (1,'Порт A',4), (1,'Порт B',4), (1,'Порт C',NULL), (1,'Заведён руками',1)"
            )
        )

    _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)

    with engine.connect() as conn:
        template_ports = dict(
            conn.execute(text("SELECT label, port_number FROM device_template_interfaces")).all()
        )
        device_ports = dict(conn.execute(text("SELECT label, port_number FROM interfaces")).all())

    # Номера идут подряд, без пропусков и повторов.
    assert sorted(template_ports.values()) == [1, 2, 3]
    assert sorted(device_ports.values()) == [1, 2, 3, 4]
    # Порядок портов сохранён: у кого номер был меньше, тот и остался раньше.
    assert template_ports["Порт A"] < template_ports["Порт B"] < template_ports["Порт C"]
    # Порт устройства получил номер своего порта в модели — состав сходится,
    # а заведённый руками ушёл в конец ряда.
    for label, number in template_ports.items():
        assert device_ports[label] == number
    assert device_ports["Заведён руками"] == 4


def test_fresh_database_has_starter_connectors(legacy_database):
    """Справочник разъёмов приезжает миграцией: без него у порта нечего
    выбрать, и первый же шаблон пришлось бы заводить в пустоту."""
    _run([sys.executable, "-m", "app.db_upgrade"], LEGACY_DB)

    with legacy_database.connect() as conn:
        rows = dict(conn.execute(text("SELECT name, is_cage FROM connector_types")).all())
    assert rows["RJ45"] is False
    assert rows["SFP+"] is True


def _head_revision() -> str:
    """Последняя ревизия берётся из самих миграций, а не пишется в тесте:
    иначе каждая новая ревизия ломала бы этот тест на ровном месте."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(os.path.join(BACKEND_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_ROOT, "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()


def test_trunk_vlans_move_to_their_own_table(legacy_database):
    """Перенос транковых VLAN из массива в таблицу.

    Значения, за которыми не стоит настоящий VLAN этой же площадки, при
    переносе отбрасываются — ради них таблица и заводится.
    """
    # Останавливаемся на шаге до переноса: именно так выглядит база,
    # которую предстоит обновить.
    _run([sys.executable, "-m", "alembic", "upgrade", "0013_audit_readable"], LEGACY_DB)

    with legacy_database.begin() as conn:
        conn.execute(text("""
            INSERT INTO device_types (id, name, code_prefix) VALUES (1, 'Коммутатор', 'SW')
        """))
        conn.execute(text("""
            INSERT INTO device_templates (id, name, device_type_id) VALUES (1, 'Модель', 1)
        """))
        site_id = conn.execute(text("SELECT id FROM sites ORDER BY id LIMIT 1")).scalar()
        conn.execute(text("""
            INSERT INTO sites (name) VALUES ('Вторая фабрика')
        """))
        other_site = conn.execute(
            text("SELECT id FROM sites WHERE name = 'Вторая фабрика'")
        ).scalar()
        conn.execute(
            text("INSERT INTO vlans (id, site_id, vlan_number) VALUES (1, :s, 10), (2, :s, 20), (3, :o, 30)"),
            {"s": site_id, "o": other_site},
        )
        conn.execute(
            text("INSERT INTO devices (id, site_id, template_id, code) VALUES (1, :s, 1, 'SW-0001')"),
            {"s": site_id},
        )
        conn.execute(
            text("""
                INSERT INTO interfaces (id, site_id, device_id, port_number, label, trunk_vlan_ids)
                VALUES (1, :s, 1, 1, 'Порт 1', ARRAY[1, 2, 3, 999999])
            """),
            {"s": site_id},
        )

    _run([sys.executable, "-m", "alembic", "upgrade", "head"], LEGACY_DB)

    with legacy_database.connect() as conn:
        moved = conn.execute(
            text("SELECT vlan_id FROM interface_trunk_vlans WHERE interface_id = 1 ORDER BY vlan_id")
        ).scalars().all()
        columns = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
             WHERE table_name = 'interfaces' AND column_name = 'trunk_vlan_ids'
        """)).all()

    assert moved == [1, 2], "переезжают только настоящие VLAN своей площадки"
    assert columns == [], "колонка-массив после переноса не нужна"


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
