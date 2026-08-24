"""Обход с телефона: второй источник для промежуточных таблиц.

Мобильное приложение уносит снимок площадки в цех и приносит оттуда то,
что нашлось на месте, — новые устройства и связи. В спецификацию
оборудования они не попадают напрямую: как и строки из файла, ложатся в
промежуточную таблицу и ждут, пока человек перенесёт их по одной,
глазами сверив с тем, что уже заведено (см. docstring `ImportRow`).

Устройства для этого переиспользуют готовую `import_rows` — заводить ей
близнеца ради того же самого незачем, и экран разбора тогда остаётся
один. Отличаются источником:

- `source='file'` — строка из загруженного файла, у неё есть имя файла и
  номер строки;
- `source='mobile'` — запись из обхода, файла у неё нет; вместо него
  `client_uuid`, выданный телефоном.

Отсюда и послабление: `source_file`/`row_number` становятся
необязательными — у обхода их нет.

`client_uuid` нужен затем, что выгрузка идёт по сети, которая рвётся:
телефон, не дождавшись ответа, шлёт пакет заново, и без ключа
идемпотентности каждое повторение задваивало бы записи. Ключ выдаёт сам
телефон, ещё оффлайн, в момент создания записи.

Связям, в отличие от устройств, промежуточной таблицы не было — она
заводится здесь. Хранит ровно то, что человек видел в цеху: какое
устройство, какой порт, куда воткнуто. Текстом, как есть, потому что
опознавать («а есть ли такой порт») — работа переноса, а не обхода.
"""

from alembic import op
import sqlalchemy as sa

revision = "0023_field_survey_staging"
down_revision = "0022_reference_versioning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "import_rows",
        sa.Column("source", sa.Text(), nullable=False, server_default="file"),
    )
    op.add_column("import_rows", sa.Column("client_uuid", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_import_rows_source", "import_rows", "source IN ('file','mobile')",
    )
    # Ключ идемпотентности — уникальный, чтобы повтор выгрузки упирался в
    # базу, а не полагался на аккуратность кода над ней.
    op.create_index(
        "ix_import_rows_client_uuid", "import_rows", ["client_uuid"], unique=True,
        postgresql_where=sa.text("client_uuid IS NOT NULL"),
    )
    # У обхода файла нет — снимаем обязательность с обеих файловых колонок.
    op.alter_column("import_rows", "source_file", existing_type=sa.Text(), nullable=True)
    op.alter_column("import_rows", "row_number", existing_type=sa.Integer(), nullable=True)

    op.create_table(
        "import_link_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "site_id", sa.Integer(),
            sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True,
        ),
        sa.Column("source", sa.Text(), nullable=False, server_default="mobile"),
        sa.Column("client_uuid", sa.Text(), nullable=True),
        # Концы связи так, как их видел человек: подпись на железке и номер
        # гнезда. Опознание — при переносе.
        sa.Column("a_device_text", sa.Text()),
        sa.Column("a_port_text", sa.Text()),
        sa.Column("b_device_text", sa.Text()),
        sa.Column("b_port_text", sa.Text()),
        # Если конец — уже заведённое устройство и телефон это знал, номер
        # сохраняем: перенос тогда не заставляет искать заново. Ссылка
        # мягкая (SET NULL): устройство могли удалить в офисе, пока шёл
        # обход, и это не повод терять саму запись обхода.
        sa.Column("a_device_id", sa.Integer(), sa.ForeignKey("devices.id", ondelete="SET NULL")),
        sa.Column("b_device_id", sa.Integer(), sa.ForeignKey("devices.id", ondelete="SET NULL")),
        sa.Column("medium", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("extra", sa.JSON()),
        sa.Column("status", sa.Text(), nullable=False, server_default="new", index=True),
        sa.Column("link_id", sa.Integer(), sa.ForeignKey("links.id", ondelete="SET NULL")),
        sa.Column("imported_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("imported_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint("status IN ('new','moved')", name="ck_import_link_rows_status"),
        sa.CheckConstraint("source IN ('file','mobile')", name="ck_import_link_rows_source"),
    )
    op.create_index(
        "ix_import_link_rows_client_uuid", "import_link_rows", ["client_uuid"], unique=True,
        postgresql_where=sa.text("client_uuid IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_import_link_rows_client_uuid", table_name="import_link_rows")
    op.drop_table("import_link_rows")

    # Возврат обязательности — только если в таблице не осталось записей
    # обхода: у них файла нет, и NOT NULL на них не встанет. Строки от
    # телефона при откате убираются, файловые не трогаются.
    op.execute("DELETE FROM import_rows WHERE source = 'mobile'")
    op.alter_column("import_rows", "row_number", existing_type=sa.Integer(), nullable=False)
    op.alter_column("import_rows", "source_file", existing_type=sa.Text(), nullable=False)
    op.drop_index("ix_import_rows_client_uuid", table_name="import_rows")
    op.drop_constraint("ck_import_rows_source", "import_rows", type_="check")
    op.drop_column("import_rows", "client_uuid")
    op.drop_column("import_rows", "source")
