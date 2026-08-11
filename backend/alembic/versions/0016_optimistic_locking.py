"""Номер правки у устройства, порта и связи.

До этого правка вторым человеком молча затирала правку первого: обе
попадали в журнал, а в базе оставалась только последняя. Теперь клиент
присылает номер, который видел, и расхождение отбивается 409.
"""

from alembic import op
import sqlalchemy as sa

revision = "0016_optimistic_locking"
down_revision = "0015_login_throttle"
branch_labels = None
depends_on = None

TABLES = ("devices", "interfaces", "links")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("version", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "version")
