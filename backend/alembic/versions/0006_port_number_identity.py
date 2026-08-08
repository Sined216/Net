"""Номер порта — обязательный и уникальный, название — просто подпись

Раньше уникальным было название порта, а номер мог пустовать и повторяться.
На практике всё наоборот: порт опознаётся по номеру, напечатанному на
корпусе, — по нему человек находит гнездо и в него включает кабель. Название
(«Gi0/1», «eth0») — подпись, и у разных портов она может совпадать.

Существующим портам без номера номера проставляются подряд, продолжая уже
занятые в пределах устройства (или шаблона).

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


def upgrade() -> None:
    for table, owner, old_unique in TABLES:
        # Проставляем номера тем портам, где их нет: нумерация продолжается
        # с максимума, уже занятого внутри того же устройства/шаблона,
        # порядок — по id, то есть по времени появления.
        op.execute(
            f"""
            WITH numbered AS (
                SELECT id,
                       COALESCE(MAX(port_number) OVER (PARTITION BY {owner}), 0)
                         + ROW_NUMBER() OVER (PARTITION BY {owner} ORDER BY id) AS next_number
                FROM {table}
                WHERE port_number IS NULL
            )
            UPDATE {table} AS t
            SET port_number = numbered.next_number
            FROM numbered
            WHERE t.id = numbered.id
            """
        )
        op.alter_column(table, "port_number", existing_type=sa.INTEGER(), nullable=False)
        op.drop_constraint(old_unique, table, type_="unique")
        op.create_unique_constraint(f"uq_{table}_number", table, [owner, "port_number"])


def downgrade() -> None:
    for table, owner, old_unique in TABLES:
        op.drop_constraint(f"uq_{table}_number", table, type_="unique")
        op.create_unique_constraint(old_unique, table, [owner, "label"])
        op.alter_column(table, "port_number", existing_type=sa.INTEGER(), nullable=True)
