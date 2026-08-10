"""Счётчик неудачных входов и время блокировки.

Вход ничем не ограничивался: пароль к учётной записи администратора
подбирался скриптом без всяких помех. Периметр внутренний, но «внутренняя
сеть» и «доверенная сеть» — не одно и то же, и это ровно тот случай, где
защита стоит две колонки.
"""

from alembic import op
import sqlalchemy as sa

revision = "0015_login_throttle"
down_revision = "0014_trunk_vlans_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("failed_logins", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_logins")
