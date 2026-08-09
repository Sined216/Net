"""Журнал изменений: площадка у записи и индексы под чтение

Журнал до сих пор только писался — прочитать его было неоткуда. Чтобы его
можно было показывать, нужны две вещи. Площадка: без неё журнал обходил бы
изоляцию — по нему были бы видны чужие устройства. И индексы: журнал
листают по времени и по конкретной записи («что было с этим устройством»),
а без индексов оба запроса читают таблицу целиком.

Уже накопленные записи остаются без площадки: к какой фабрике они
относились, задним числом уже не выяснить, а до этой миграции площадка была
одна. Такие записи видны всем — как и записи об общих справочниках.

Revision ID: 0013_audit_readable
Revises: 0012_sites
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_audit_readable"
down_revision: Union[str, None] = "0012_sites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_log", sa.Column("site_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_audit_log_site", "audit_log", "sites", ["site_id"], ["id"],
                          ondelete="CASCADE")
    op.create_index("ix_audit_log_site_id", "audit_log", ["site_id"])
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])
    op.create_index("ix_audit_entity", "audit_log", ["entity_type", "entity_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_entity", table_name="audit_log")
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_index("ix_audit_log_site_id", table_name="audit_log")
    op.drop_constraint("fk_audit_log_site", "audit_log", type_="foreignkey")
    op.drop_column("audit_log", "site_id")
