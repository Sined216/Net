"""Номер правки у справочников — вслед за устройством, портом и связью.

0016 завела номер правки только трём сущностям: у остальных второй
сохранивший молча затирал первого — воспроизведено на VLAN (см.
docs/UX-REVIEW-2026-08-18.md, находка 2). Здесь тот же столбец у
одиннадцати сущностей, которым его не хватало: справочники, шаблоны,
пользователи, площадки, теги и группы топологии.
"""

from alembic import op
import sqlalchemy as sa

revision = "0022_reference_versioning"
down_revision = "0021_search_trgm_indexes"
branch_labels = None
depends_on = None

TABLES = (
    "sites", "tags", "users", "device_types", "vlans",
    "device_templates", "device_template_interfaces",
    "connector_types", "transceiver_modules", "topology_groups", "link_templates",
)


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("version", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "version")
