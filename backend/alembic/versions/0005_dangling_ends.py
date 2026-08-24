"""Подвешенные концы связей и порты, редактируемые на устройстве

Раньше удаление порта каскадом уносило и связь: FK стоял с ON DELETE CASCADE,
а колонки были NOT NULL. В жизни это неверно — сняли с ПК сетевую карту, но
кабель остался проложен и никуда не делся. Теперь конец связи может пустовать
(«подвешен»), и его подключают заново к новому порту.

Заодно у шаблона появляется признак, что состав портов у этой модели меняется
по факту (ПК с добавляемой сетевой картой), а не задан раз и навсегда.

Revision ID: 0005_dangling_ends
Revises: 0004_template_color
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_dangling_ends"
down_revision: Union[str, None] = "0004_template_color"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "device_templates",
        sa.Column("ports_editable_on_device", sa.Boolean(), server_default="false", nullable=False),
    )

    op.alter_column("links", "interface_a_id", existing_type=sa.INTEGER(), nullable=True)
    op.alter_column("links", "interface_b_id", existing_type=sa.INTEGER(), nullable=True)

    for side in ("a", "b"):
        op.drop_constraint(f"links_interface_{side}_id_fkey", "links", type_="foreignkey")
        op.create_foreign_key(
            f"links_interface_{side}_id_fkey", "links", "interfaces",
            [f"interface_{side}_id"], ["id"], ondelete="SET NULL",
        )

    # Связь без обоих концов — мусор, её нужно удалять целиком.
    op.create_check_constraint(
        "ck_links_has_endpoint", "links",
        "interface_a_id IS NOT NULL OR interface_b_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_links_has_endpoint", "links", type_="check")

    # NOT NULL вернуть нельзя, пока есть подвешенные концы: такие связи
    # откатом теряются — держать их прежняя схема не умеет.
    op.execute("DELETE FROM links WHERE interface_a_id IS NULL OR interface_b_id IS NULL")

    for side in ("a", "b"):
        op.drop_constraint(f"links_interface_{side}_id_fkey", "links", type_="foreignkey")
        op.create_foreign_key(
            f"links_interface_{side}_id_fkey", "links", "interfaces",
            [f"interface_{side}_id"], ["id"], ondelete="CASCADE",
        )

    op.alter_column("links", "interface_b_id", existing_type=sa.INTEGER(), nullable=False)
    op.alter_column("links", "interface_a_id", existing_type=sa.INTEGER(), nullable=False)

    op.drop_column("device_templates", "ports_editable_on_device")
