"""Промежуточная таблица для импорта устройств из файла

Файл не заводит устройства сам: в нём бывают опечатки, неизвестные модели и
наполовину пустые строки, а код устройства раздаёт система. Строки ложатся
сюда, а человек переносит их в спецификацию по одной, проверяя каждую.

Revision ID: 0011_import_rows
Revises: 0010_port_from_template
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_import_rows"
down_revision: Union[str, None] = "0010_port_from_template"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "import_rows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_file", sa.Text(), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("template_name", sa.Text(), nullable=True),
        sa.Column("type_name", sa.Text(), nullable=True),
        sa.Column("management_ip", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("tags_text", sa.Text(), nullable=True),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="new"),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("imported_by", sa.Integer(), nullable=True),
        sa.CheckConstraint("status IN ('new','moved')"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["imported_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_rows_status", "import_rows", ["status"])


def downgrade() -> None:
    op.drop_index("ix_import_rows_status", table_name="import_rows")
    op.drop_table("import_rows")
