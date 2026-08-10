"""Транковые VLAN — отдельной таблицей вместо массива чисел.

`interfaces.trunk_vlan_ids` был единственным местом схемы, где не
проверялось ничего: в массив ложился любой идентификатор, в том числе
удалённого VLAN и VLAN чужой площадки. Составными ключами это чинится так
же, как всё остальное в проекте: строка транка знает свою площадку, и
`site_id` сверяется сразу с портом и с VLAN.

Значения, которые не проходят проверку (VLAN не существует или он с другой
площадки), при переносе отбрасываются: они и означали ошибку, ради которой
таблица заводится.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014_trunk_vlans_table"
down_revision = "0013_audit_readable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "interface_trunk_vlans",
        sa.Column("interface_id", sa.Integer(), nullable=False),
        sa.Column("vlan_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("interface_id", "vlan_id"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["interface_id", "site_id"], ["interfaces.id", "interfaces.site_id"],
            ondelete="CASCADE", name="fk_trunk_interface_site",
        ),
        sa.ForeignKeyConstraint(
            ["vlan_id", "site_id"], ["vlans.id", "vlans.site_id"],
            ondelete="CASCADE", name="fk_trunk_vlan_site",
        ),
    )
    op.create_index("ix_interface_trunk_vlans_site_id", "interface_trunk_vlans", ["site_id"])

    op.execute(
        """
        INSERT INTO interface_trunk_vlans (interface_id, vlan_id, site_id)
        SELECT DISTINCT i.id, v.id, i.site_id
          FROM interfaces i
          CROSS JOIN LATERAL unnest(coalesce(i.trunk_vlan_ids, '{}')) AS t(vlan_id)
          JOIN vlans v ON v.id = t.vlan_id AND v.site_id = i.site_id
        """
    )
    op.drop_column("interfaces", "trunk_vlan_ids")


def downgrade() -> None:
    op.add_column("interfaces", sa.Column("trunk_vlan_ids", postgresql.ARRAY(sa.Integer()), nullable=True))
    op.execute(
        """
        UPDATE interfaces i
           SET trunk_vlan_ids = t.ids
          FROM (
                SELECT interface_id, array_agg(vlan_id ORDER BY vlan_id) AS ids
                  FROM interface_trunk_vlans
                 GROUP BY interface_id
               ) t
         WHERE t.interface_id = i.id
        """
    )
    op.drop_index("ix_interface_trunk_vlans_site_id", table_name="interface_trunk_vlans")
    op.drop_table("interface_trunk_vlans")
