"""Номер порта — обязательный и уникальный, название — просто подпись

Раньше уникальным было название порта, а номер мог пустовать и повторяться.
На практике всё наоборот: порт опознаётся по номеру, напечатанному на
корпусе, — по нему человек находит гнездо и в него включает кабель. Название
(«Gi0/1», «eth0») — подпись, и у разных портов она может совпадать.

Существующим данным номера приходится приводить в порядок: у портов номера
не только пустовали, но и повторялись — номер ничего не значил, и ничто не
мешало проставить один и тот же дважды. Поэтому здесь не просто заполнение
пустых мест, а разбор конфликтов:

* у портов устройства номер берётся из одноимённого порта его модели —
  тогда состав портов устройства и модели совпадает и по номерам, а не
  только по названиям (сопоставление по названию однозначно: до этой
  ревизии название было уникальным и в модели, и в устройстве);
* если один и тот же номер занят дважды, его сохраняет первый по времени
  появления порт, остальные считаются ненумерованными;
* ненумерованные получают номера подряд, продолжая максимум, уже занятый
  внутри того же устройства (или модели).

Revision ID: 0006_port_number_identity
Revises: 0005_dangling_ends
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_port_number_identity"
down_revision: Union[str, None] = "0005_dangling_ends"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (таблица, колонка-владелец, старое уникальное ограничение)
TABLES = [
    ("device_template_interfaces", "template_id", "device_template_interfaces_template_id_label_key"),
    ("interfaces", "device_id", "interfaces_device_id_label_key"),
]


def _drop_duplicates(table: str, owner: str, join: str = "", priority: str = "0") -> None:
    """Оставить номер только за одним портом, у остальных обнулить.

    `priority` — выражение, по которому выбирается «настоящий» владелец
    номера (меньше — важнее); при равенстве побеждает тот, кто появился
    раньше.
    """
    op.execute(
        f"""
        WITH ranked AS (
            SELECT t.id,
                   ROW_NUMBER() OVER (
                       PARTITION BY t.{owner}, t.port_number
                       ORDER BY {priority}, t.id
                   ) AS rank
            FROM {table} AS t
            {join}
            WHERE t.port_number IS NOT NULL
        )
        UPDATE {table} AS t
        SET port_number = NULL
        FROM ranked
        WHERE t.id = ranked.id AND ranked.rank > 1
        """
    )


def _fill_gaps(table: str, owner: str) -> None:
    """Раздать номера тем, у кого их нет, продолжая занятые в той же группе."""
    op.execute(
        f"""
        WITH taken AS (
            SELECT {owner} AS owner_id, MAX(port_number) AS max_number
            FROM {table}
            GROUP BY {owner}
        ),
        missing AS (
            SELECT id, {owner} AS owner_id,
                   ROW_NUMBER() OVER (PARTITION BY {owner} ORDER BY id) AS offset_number
            FROM {table}
            WHERE port_number IS NULL
        )
        UPDATE {table} AS t
        SET port_number = COALESCE(taken.max_number, 0) + missing.offset_number
        FROM missing LEFT JOIN taken ON taken.owner_id = missing.owner_id
        WHERE t.id = missing.id
        """
    )


def upgrade() -> None:
    # 1. Модели: конфликты разбираются по времени появления порта.
    _drop_duplicates("device_template_interfaces", "template_id")
    _fill_gaps("device_template_interfaces", "template_id")

    # 2. Устройства: номер берётся из одноимённого порта модели. Такие порты
    #    и есть «настоящие» — они появились из модели, а не заведены руками,
    #    поэтому в споре за номер они выигрывают.
    op.execute(
        """
        CREATE TEMP TABLE _from_template AS
        SELECT i.id AS interface_id, ti.port_number AS port_number
        FROM interfaces AS i
        JOIN devices AS d ON d.id = i.device_id
        JOIN device_template_interfaces AS ti
          ON ti.template_id = d.template_id AND ti.label = i.label
        """
    )
    op.execute(
        """
        UPDATE interfaces AS i
        SET port_number = f.port_number
        FROM _from_template AS f
        WHERE i.id = f.interface_id
        """
    )
    _drop_duplicates(
        "interfaces", "device_id",
        join="LEFT JOIN _from_template AS f ON f.interface_id = t.id",
        priority="(CASE WHEN f.interface_id IS NULL THEN 1 ELSE 0 END)",
    )
    _fill_gaps("interfaces", "device_id")
    op.execute("DROP TABLE _from_template")

    for table, owner, old_unique in TABLES:
        op.alter_column(table, "port_number", existing_type=sa.INTEGER(), nullable=False)
        op.drop_constraint(old_unique, table, type_="unique")
        op.create_unique_constraint(f"uq_{table}_number", table, [owner, "port_number"])


def downgrade() -> None:
    for table, owner, old_unique in TABLES:
        op.drop_constraint(f"uq_{table}_number", table, type_="unique")
        op.create_unique_constraint(old_unique, table, [owner, "label"])
        op.alter_column(table, "port_number", existing_type=sa.INTEGER(), nullable=True)
