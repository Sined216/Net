"""Изоляция площадок: разные фабрики не пересекаются

Сети разных фабрик не должны пересекаться никак. Проверок в приложении для
этого мало: одна ошибка в запросе — и кабель уедет между фабриками.
Поэтому изоляция закрепляется в самой базе составными внешними ключами
(id, site_id): порт может принадлежать только устройству своей площадки, а
кабель — только портам своей.

Все существующие данные уезжают на площадку «Основная площадка»: пока
фабрика одна, ничего не меняется, а разделить можно в любой момент.

Требуется PostgreSQL 15+ — ради `ON DELETE SET NULL (колонка)`. Без
перечисления колонки снятие порта обнуляло бы вместе со ссылкой и площадку
кабеля, а она NOT NULL.

Revision ID: 0012_sites
Revises: 0011_import_rows
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_sites"
down_revision: Union[str, None] = "0011_import_rows"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_SITE = "Основная площадка"

# Таблицы, которые описывают сеть конкретной фабрики. Справочники моделей
# техники, разъёмов и пресетов кабелей остаются общими: заводить «Cisco
# Catalyst 2960» заново на каждой площадке незачем.
SITE_TABLES = ("devices", "interfaces", "links", "topology_groups", "tags", "vlans", "import_rows")


def upgrade() -> None:
    op.create_table(
        "sites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "user_sites",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "site_id"),
    )

    # Площадка заводится всегда, в том числе на пустой базе: без неё
    # приложению не с чем работать, а первый запуск не должен требовать
    # ручного шага.
    op.execute(sa.text("INSERT INTO sites (name) VALUES (:name)").bindparams(name=DEFAULT_SITE))
    site_id = op.get_bind().execute(
        sa.text("SELECT id FROM sites WHERE name = :name").bindparams(name=DEFAULT_SITE)
    ).scalar_one()

    # Пока площадка одна, доступ к ней есть у всех заведённых людей —
    # иначе после наката все, кроме админов, увидели бы пустую систему.
    op.execute(sa.text("INSERT INTO user_sites (user_id, site_id) SELECT id, :site FROM users")
               .bindparams(site=site_id))

    # Колонка добавляется со значением по умолчанию (иначе NOT NULL не встанет
    # на непустой таблице), после чего умолчание снимается: площадку должен
    # задавать тот, кто пишет, а не база.
    for table in SITE_TABLES:
        op.add_column(table, sa.Column("site_id", sa.Integer(), nullable=False,
                                       server_default=str(site_id)))
        op.alter_column(table, "site_id", server_default=None)
        op.create_foreign_key(f"fk_{table}_site", table, "sites", ["site_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{table}_site_id", table, ["site_id"])

    # Уникальности, которые были глобальными, становятся уникальностями
    # внутри площадки: VLAN 10 и цех «Цех 1» есть на каждой фабрике.
    op.drop_constraint("vlans_vlan_number_key", "vlans", type_="unique")
    op.create_unique_constraint("uq_vlans_number", "vlans", ["site_id", "vlan_number"])
    op.drop_constraint("tags_parent_id_name_key", "tags", type_="unique")
    op.create_unique_constraint("uq_tags_name", "tags", ["site_id", "parent_id", "name"])
    op.drop_constraint("topology_groups_name_key", "topology_groups", type_="unique")
    op.create_unique_constraint("uq_topology_groups_name", "topology_groups", ["site_id", "name"])

    # Мишени для составных ключей: сослаться на пару (id, site_id) можно
    # только если такая пара объявлена уникальной.
    op.create_unique_constraint("uq_devices_site", "devices", ["id", "site_id"])
    op.create_unique_constraint("uq_interfaces_site", "interfaces", ["id", "site_id"])
    op.create_unique_constraint("uq_vlans_site", "vlans", ["id", "site_id"])
    op.create_unique_constraint("uq_topology_groups_site", "topology_groups", ["id", "site_id"])

    # Собственно изоляция. Одиночные ключи заменяются составными: порт — при
    # устройстве своей площадки, кабель — при портах своей, устройство — в
    # группе своей.
    op.drop_constraint("interfaces_device_id_fkey", "interfaces", type_="foreignkey")
    op.create_foreign_key(
        "fk_interfaces_device_site", "interfaces", "devices",
        ["device_id", "site_id"], ["id", "site_id"], ondelete="CASCADE",
    )
    op.drop_constraint("interfaces_vlan_id_fkey", "interfaces", type_="foreignkey")
    op.execute(
        "ALTER TABLE interfaces ADD CONSTRAINT fk_interfaces_vlan_site "
        "FOREIGN KEY (vlan_id, site_id) REFERENCES vlans (id, site_id) "
        "ON DELETE SET NULL (vlan_id)"
    )
    op.drop_constraint("devices_topology_group_id_fkey", "devices", type_="foreignkey")
    op.execute(
        "ALTER TABLE devices ADD CONSTRAINT fk_devices_group_site "
        "FOREIGN KEY (topology_group_id, site_id) REFERENCES topology_groups (id, site_id) "
        "ON DELETE SET NULL (topology_group_id)"
    )
    op.drop_constraint("links_interface_a_id_fkey", "links", type_="foreignkey")
    op.drop_constraint("links_interface_b_id_fkey", "links", type_="foreignkey")
    op.execute(
        "ALTER TABLE links ADD CONSTRAINT fk_links_a_site "
        "FOREIGN KEY (interface_a_id, site_id) REFERENCES interfaces (id, site_id) "
        "ON DELETE SET NULL (interface_a_id)"
    )
    op.execute(
        "ALTER TABLE links ADD CONSTRAINT fk_links_b_site "
        "FOREIGN KEY (interface_b_id, site_id) REFERENCES interfaces (id, site_id) "
        "ON DELETE SET NULL (interface_b_id)"
    )


def downgrade() -> None:
    op.drop_constraint("fk_links_a_site", "links", type_="foreignkey")
    op.drop_constraint("fk_links_b_site", "links", type_="foreignkey")
    op.create_foreign_key("links_interface_a_id_fkey", "links", "interfaces",
                          ["interface_a_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("links_interface_b_id_fkey", "links", "interfaces",
                          ["interface_b_id"], ["id"], ondelete="SET NULL")

    op.drop_constraint("fk_devices_group_site", "devices", type_="foreignkey")
    op.create_foreign_key("devices_topology_group_id_fkey", "devices", "topology_groups",
                          ["topology_group_id"], ["id"], ondelete="SET NULL")
    op.drop_constraint("fk_interfaces_vlan_site", "interfaces", type_="foreignkey")
    op.create_foreign_key("interfaces_vlan_id_fkey", "interfaces", "vlans",
                          ["vlan_id"], ["id"], ondelete="SET NULL")
    op.drop_constraint("fk_interfaces_device_site", "interfaces", type_="foreignkey")
    op.create_foreign_key("interfaces_device_id_fkey", "interfaces", "devices",
                          ["device_id"], ["id"], ondelete="CASCADE")

    op.drop_constraint("uq_topology_groups_site", "topology_groups", type_="unique")
    op.drop_constraint("uq_vlans_site", "vlans", type_="unique")
    op.drop_constraint("uq_interfaces_site", "interfaces", type_="unique")
    op.drop_constraint("uq_devices_site", "devices", type_="unique")

    op.drop_constraint("uq_topology_groups_name", "topology_groups", type_="unique")
    op.create_unique_constraint("topology_groups_name_key", "topology_groups", ["name"])
    op.drop_constraint("uq_tags_name", "tags", type_="unique")
    op.create_unique_constraint("tags_parent_id_name_key", "tags", ["parent_id", "name"])
    op.drop_constraint("uq_vlans_number", "vlans", type_="unique")
    op.create_unique_constraint("vlans_vlan_number_key", "vlans", ["vlan_number"])

    for table in SITE_TABLES:
        op.drop_index(f"ix_{table}_site_id", table_name=table)
        op.drop_constraint(f"fk_{table}_site", table, type_="foreignkey")
        op.drop_column(table, "site_id")

    op.drop_table("user_sites")
    op.drop_table("sites")
