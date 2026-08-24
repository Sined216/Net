"""Вложенные группы на топологии

Цех делится на участки, участок — на линии. Одной плоской группы для этого
мало: рамка «цех» должна охватывать рамки участков, а не перечислять все
устройства заново.

Устройство по-прежнему принадлежит ровно одной группе — самой внутренней.
Остальные охватывают его через вложенность.

Revision ID: 0007_nested_topology_groups
Revises: 0006_port_number_identity
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_nested_topology_groups"
down_revision: Union[str, None] = "0006_port_number_identity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("topology_groups", sa.Column("parent_id", sa.Integer(), nullable=True))
    # SET NULL, а не CASCADE: удаление цеха не должно уносить с собой
    # участки вместе с их устройствами — подгруппы всплывают на уровень выше.
    op.create_foreign_key(
        "topology_groups_parent_id_fkey", "topology_groups", "topology_groups",
        ["parent_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_topology_groups_parent_id", "topology_groups", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_topology_groups_parent_id", table_name="topology_groups")
    op.drop_constraint("topology_groups_parent_id_fkey", "topology_groups", type_="foreignkey")
    op.drop_column("topology_groups", "parent_id")
