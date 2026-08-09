"""Разъёмы портов, модули и режим порта

Три связанные правки, которые нельзя делать по отдельности:

* появился справочник разъёмов (RJ45, SFP, LC...). Разъём — свойство модели
  техники, поэтому он у порта шаблона, а порт устройства получает его копию;
* SFP и подобные — не разъёмы, а клетки: разъём у них появляется вместе с
  модулем. Отсюда справочник модулей и ссылка на вставленный модуль у порта
  устройства;
* «тип порта» (доступ/транк/аплинк) переименован в «режим» и убран из
  шаблона: это настройка конкретной железки, в модели она ничего не значила.
  Слово «тип» освободилось под разъём, которому оно подходит.

Существующим портам разъём проставляется RJ45 — на заводе это подавляющее
большинство, а неверные единицы правятся в шаблоне за пару минут.

Revision ID: 0009_connectors_and_modules
Revises: 0008_group_geometry
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_connectors_and_modules"
down_revision: Union[str, None] = "0008_group_geometry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (название, среда, клетка ли). Стартовый набор — то, что реально встречается
# на заводе; остальное добавляется в справочнике руками.
CONNECTORS = [
    ("RJ45", "copper", False),
    ("M12", "copper", False),
    ("SFP", "other", True),
    ("SFP+", "other", True),
    ("QSFP+", "other", True),
    ("LC", "fiber", False),
    ("SC", "fiber", False),
    ("USB", "other", False),
    ("RS-485", "other", False),
]


def upgrade() -> None:
    op.create_table(
        "connector_types",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("media", sa.Text(), nullable=False, server_default="copper"),
        sa.Column("is_cage", sa.Boolean(), nullable=False, server_default="false"),
        sa.CheckConstraint("media IN ('copper','fiber','other')"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "transceiver_modules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("cage_connector_id", sa.Integer(), nullable=True),
        sa.Column("connector_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["cage_connector_id"], ["connector_types.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["connector_id"], ["connector_types.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    connectors = sa.table(
        "connector_types",
        sa.column("name", sa.Text), sa.column("media", sa.Text), sa.column("is_cage", sa.Boolean),
    )
    op.bulk_insert(connectors, [
        {"name": name, "media": media, "is_cage": is_cage} for name, media, is_cage in CONNECTORS
    ])

    for table in ("device_template_interfaces", "interfaces"):
        op.add_column(table, sa.Column("connector_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            f"{table}_connector_id_fkey", table, "connector_types",
            ["connector_id"], ["id"], ondelete="SET NULL",
        )
        # Разъём по умолчанию: медный порт — это то, что стоит почти везде.
        op.execute(
            f"UPDATE {table} SET connector_id = (SELECT id FROM connector_types WHERE name = 'RJ45')"
        )

    op.add_column("interfaces", sa.Column("module_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "interfaces_module_id_fkey", "interfaces", "transceiver_modules",
        ["module_id"], ["id"], ondelete="SET NULL",
    )

    # Режим остаётся только у устройства и под своим настоящим именем.
    op.alter_column("interfaces", "port_type", new_column_name="mode")
    op.drop_constraint("interfaces_port_type_check", "interfaces", type_="check")
    op.create_check_constraint(
        "interfaces_mode_check", "interfaces", "mode IN ('access','trunk','uplink') OR mode IS NULL",
    )
    op.drop_constraint("device_template_interfaces_port_type_check", "device_template_interfaces", type_="check")
    op.drop_column("device_template_interfaces", "port_type")


def downgrade() -> None:
    op.add_column("device_template_interfaces", sa.Column("port_type", sa.Text(), nullable=True))
    op.create_check_constraint(
        "device_template_interfaces_port_type_check", "device_template_interfaces",
        "port_type IN ('access','trunk','uplink') OR port_type IS NULL",
    )
    op.drop_constraint("interfaces_mode_check", "interfaces", type_="check")
    op.alter_column("interfaces", "mode", new_column_name="port_type")
    op.create_check_constraint(
        "interfaces_port_type_check", "interfaces",
        "port_type IN ('access','trunk','uplink') OR port_type IS NULL",
    )

    op.drop_constraint("interfaces_module_id_fkey", "interfaces", type_="foreignkey")
    op.drop_column("interfaces", "module_id")
    for table in ("device_template_interfaces", "interfaces"):
        op.drop_constraint(f"{table}_connector_id_fkey", table, type_="foreignkey")
        op.drop_column(table, "connector_id")
    op.drop_table("transceiver_modules")
    op.drop_table("connector_types")
