"""Нативные типы PostgreSQL для адресов и дат + строгий порядок сторон связи

Приводит базу к тому, что всегда было описано в schema.sql: адреса как
INET/CIDR, MAC как MACADDR, дата установки как DATE. Модели SQLAlchemy
объявляли эти колонки строками, поэтому база, поднятая приложением, и база,
поднятая из schema.sql, различались — это и чинится здесь.

Преобразование выдержит только корректные данные. Пустые строки считаются
отсутствием значения и превращаются в NULL, а вот настоящий мусор
(«не знаю», «10.10.1.300») миграцию уронит — намеренно: молча выбросить
такие значения хуже, чем остановиться и дать их поправить. Найти проблемные
строки заранее:

    SELECT id, management_ip FROM devices
    WHERE management_ip IS NOT NULL AND management_ip <> ''
      AND management_ip !~ '^[0-9a-fA-F:.]+(/[0-9]+)?$';

Revision ID: 0002_native_types
Revises: 0001_baseline
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_native_types"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (таблица, колонка, целевой тип, тип для отката)
COLUMNS = [
    ("devices", "management_ip", postgresql.INET(), "inet"),
    ("devices", "install_date", sa.Date(), "date"),
    ("interfaces", "ip", postgresql.INET(), "inet"),
    ("interfaces", "mac", postgresql.MACADDR(), "macaddr"),
    ("vlans", "subnet", postgresql.CIDR(), "cidr"),
    ("vlans", "gateway", postgresql.INET(), "inet"),
]


def upgrade() -> None:
    for table, column, target_type, pg_type in COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.VARCHAR(),
            type_=target_type,
            existing_nullable=True,
            # Без USING PostgreSQL отказывается приводить text к inet/macaddr/date.
            # NULLIF: пустая строка из формы — это «не заполнено», а не ошибка.
            postgresql_using=f"NULLIF(TRIM({column}), '')::{pg_type}",
        )

    # Стороны связи нормализуются по возрастанию id — теперь это гарантирует
    # база, а не только код. Прежнее ограничение (<>) слабее: оно допускало
    # запись той же связи ещё и зеркально.
    #
    # links_check — имя, которое PostgreSQL дал безымянному CHECK из baseline.
    # Новое ограничение заводится с явным именем, чтобы дальше на него можно
    # было ссылаться, не заглядывая в pg_constraint.
    op.drop_constraint("links_check", "links", type_="check")
    op.create_check_constraint("ck_links_interfaces_ordered", "links", "interface_a_id < interface_b_id")


def downgrade() -> None:
    op.drop_constraint("ck_links_interfaces_ordered", "links", type_="check")
    op.create_check_constraint("links_check", "links", "interface_a_id <> interface_b_id")

    for table, column, target_type, _ in COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=target_type,
            type_=sa.VARCHAR(),
            existing_nullable=True,
            postgresql_using=f"{column}::text",
        )
