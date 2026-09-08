"""Настройка принтера этикеток.

Отдельная таблица от `password_policy`, хоть форма («одна строка») та же:
это разные заботы, и правка одной не должна тянуть миграцию другой. Общий
файл-роутер (`app/routers/system_settings.py`) — общая только форма
хранения, не содержание.

Принтер один физический на цех — строка заводится пустой (`host = NULL`),
печать тогда отвечает понятной ошибкой «принтер не настроен», а не пытается
достучаться в никуда.
"""

from alembic import op
import sqlalchemy as sa

revision = "0025_printer_settings"
down_revision = "0024_password_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "printer_settings",
        sa.Column("id", sa.Integer(), primary_key=True, server_default="1"),
        sa.Column("host", sa.Text()),
        sa.Column("port", sa.Integer(), nullable=False, server_default="9100"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("id = 1", name="ck_printer_settings_singleton"),
    )
    op.execute("INSERT INTO printer_settings (id, host, port) VALUES (1, NULL, 9100)")


def downgrade() -> None:
    op.drop_table("printer_settings")
