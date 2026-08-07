"""Приведение базы к последней миграции при старте контейнера.

Отдельный шаг, а не `create_all()` в приложении: create_all умеет только
досоздавать отсутствующие таблицы и молча игнорирует изменения в
существующих, поэтому любая правка схемы после первого запуска до базы не
доезжала.

Отдельно обрабатывается случай базы, поднятой ещё старым create_all: таблицы
там есть, а истории миграций нет. Такую базу нельзя «накатывать с нуля» —
первая ревизия попыталась бы создать уже существующие таблицы. Поэтому она
помечается штампом baseline (схема на момент подключения Alembic), после
чего применяются только последующие миграции.

Запуск: python -m app.db_upgrade
"""

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.database import engine

log = logging.getLogger("netdoc.migrations")

BACKEND_ROOT = Path(__file__).resolve().parent.parent
BASELINE_REVISION = "0001_baseline"


def _alembic_config() -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    # Пути в alembic.ini относительные, а запускать нас могут из любой папки.
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def upgrade_database() -> None:
    tables = set(inspect(engine).get_table_names())
    config = _alembic_config()

    if "alembic_version" not in tables and "users" in tables:
        log.warning(
            "База создана до подключения миграций — помечаю как %s и накатываю остальные",
            BASELINE_REVISION,
        )
        command.stamp(config, BASELINE_REVISION)

    command.upgrade(config, "head")
    log.info("Схема базы актуальна")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    upgrade_database()
