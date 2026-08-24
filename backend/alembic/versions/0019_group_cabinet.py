"""Вид группы: обычная рамка или шкаф.

Группы на площадке вкладываются друг в друга — цех, участок, линия — но
шкаф в этой цепочке особый: не область на плане, а физическая железка со
своим содержимым, дальше которой вложенность не идёт. До сих пор такого
различия в модели не было — рамка шкафа рисовалась и вела себя как любая
другая группа.

`kind` — текст с двумя значениями вместо отдельной таблицы или булева поля:
булево «is_cabinet» не переживёт третий вид группы, если он появится, а
заводить отдельную сущность ради одного столбца — обратно тому решению,
на котором построен весь пункт 16 (шкаф — вид группы, а не новая сущность).
"""

from alembic import op
import sqlalchemy as sa

revision = "0019_group_cabinet"
down_revision = "0018_drop_location"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "topology_groups",
        sa.Column("kind", sa.Text(), nullable=False, server_default="area"),
    )
    op.create_check_constraint(
        "ck_topology_groups_kind", "topology_groups", "kind IN ('area','cabinet')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_topology_groups_kind", "topology_groups", type_="check")
    op.drop_column("topology_groups", "kind")
