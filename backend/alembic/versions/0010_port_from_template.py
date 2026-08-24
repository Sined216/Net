"""Порт устройства помнит, из какого порта модели он скопирован

Сопоставлялись они по номеру, и это разъезжалось. У ПК со съёмными картами
сняли вторую карту — номера оставшихся сомкнулись, и правка порта №2 в
модели переименовывала на этом ПК уже другой порт. Молча и без следа.

Существующим портам ссылка проставляется по номеру — единственному, что о
их происхождении известно. Портам, которых в модели нет (заведены руками),
остаётся пусто.

Revision ID: 0010_port_from_template
Revises: 0009_connectors_and_modules
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_port_from_template"
down_revision: Union[str, None] = "0009_connectors_and_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("interfaces", sa.Column("template_interface_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "interfaces_template_interface_id_fkey", "interfaces", "device_template_interfaces",
        ["template_interface_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_interfaces_template_interface_id", "interfaces", ["template_interface_id"])
    op.execute(
        """
        UPDATE interfaces AS i
        SET template_interface_id = ti.id
        FROM devices AS d
        JOIN device_template_interfaces AS ti ON ti.template_id = d.template_id
        WHERE d.id = i.device_id AND ti.port_number = i.port_number
        """
    )


def downgrade() -> None:
    op.drop_index("ix_interfaces_template_interface_id", table_name="interfaces")
    op.drop_constraint("interfaces_template_interface_id_fkey", "interfaces", type_="foreignkey")
    op.drop_column("interfaces", "template_interface_id")
