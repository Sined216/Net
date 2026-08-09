"""Положение и размер рамки группы

Раньше рамка подгонялась под содержимое: её нельзя было ни подвинуть, ни
растянуть, а состав группы менялся перетаскиванием устройства в рамку — то
есть жест «подвинуть узел» и жест «сменить группу» были одним и тем же.
Теперь рамка — самостоятельная область на схеме со своими координатами, а
состав правится явно.

Колонки необязательные: у групп, заведённых раньше, рамка так и считается
по содержимому, пока её первый раз не подвинут или не растянут.

Revision ID: 0008_group_geometry
Revises: 0007_nested_topology_groups
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_group_geometry"
down_revision: Union[str, None] = "0007_nested_topology_groups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = ["x", "y", "width", "height"]


def upgrade() -> None:
    for name in COLUMNS:
        op.add_column("topology_groups", sa.Column(name, sa.Float(), nullable=True))


def downgrade() -> None:
    for name in COLUMNS:
        op.drop_column("topology_groups", name)
