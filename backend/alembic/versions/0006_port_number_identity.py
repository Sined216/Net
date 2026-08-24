"""Номер порта — обязательный, уникальный и сплошной, название — просто подпись

Раньше уникальным было название порта, а номер мог пустовать и повторяться.
На практике всё наоборот: порт опознаётся по номеру, напечатанному на
корпусе, — по нему человек находит гнездо и в него включает кабель. Название
(«Gi0/1», «eth0») — подпись, и у разных портов она может совпадать.

Номер — ещё и место в ряду гнёзд: номера идут подряд, 1..N, без пропусков,
потому что дырка в ряду означала бы гнездо, которого нет. Существующие
данные под это пересобираются целиком — номер раньше ничего не значил, мог
пустовать и мог повторяться. Порты нумеруются заново, прежний порядок при
этом сохраняется:

* порты модели — по номеру, ненумерованные следом, по времени появления;
* порты устройства — в порядке одноимённых портов его модели, чтобы состав
  устройства и модели совпадал и по номерам, а не только по названиям
  (сопоставление по названию однозначно: до этой ревизии название было
  уникальным и в модели, и в устройстве); заведённые руками порты уходят в
  конец ряда.

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


def _renumber(table: str, owner: str, order_by: str, join: str = "") -> None:
    """Пронумеровать порты подряд, 1..N внутри каждой модели/устройства.

    Одним запросом «на месте» — уникальности номера на этот момент ещё нет,
    она добавляется в конце ревизии, уже поверх приведённых в порядок
    данных.
    """
    op.execute(
        f"""
        WITH ordered AS (
            SELECT t.id,
                   ROW_NUMBER() OVER (PARTITION BY t.{owner} ORDER BY {order_by}) AS number
            FROM {table} AS t
            {join}
        )
        UPDATE {table} AS t
        SET port_number = ordered.number
        FROM ordered
        WHERE t.id = ordered.id
        """
    )


def upgrade() -> None:
    # 1. Модели: порядок задаёт прежний номер, ненумерованные идут следом.
    _renumber(
        "device_template_interfaces", "template_id",
        order_by="t.port_number NULLS LAST, t.id",
    )

    # 2. Устройства: порядок задаёт номер одноимённого порта модели, а порты,
    #    заведённые руками (такого в модели нет), уходят в конец.
    _renumber(
        "interfaces", "device_id",
        join="""
            LEFT JOIN devices AS d ON d.id = t.device_id
            LEFT JOIN device_template_interfaces AS ti
              ON ti.template_id = d.template_id AND ti.label = t.label
        """,
        order_by="ti.port_number NULLS LAST, t.port_number NULLS LAST, t.id",
    )

    for table, owner, old_unique in TABLES:
        op.alter_column(table, "port_number", existing_type=sa.INTEGER(), nullable=False)
        op.drop_constraint(old_unique, table, type_="unique")
        op.create_unique_constraint(f"uq_{table}_number", table, [owner, "port_number"])


def downgrade() -> None:
    for table, owner, old_unique in TABLES:
        op.drop_constraint(f"uq_{table}_number", table, type_="unique")
        op.create_unique_constraint(old_unique, table, [owner, "label"])
        op.alter_column(table, "port_number", existing_type=sa.INTEGER(), nullable=True)
