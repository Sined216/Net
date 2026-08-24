"""Индексы для поиска по куску MAC/IP

Поиск по MAC и IP (`_mac_like`, `devices.py`, и общий поиск в
`interfaces.py`) оборачивает колонку в `replace()`/`cast()`, чтобы сравнить
её текстом независимо от разделителей и приведения типа. Обычный B-tree
индекс тут бесполезен вдвойне: он не покрывает такое выражение и всё равно
не помог бы `ILIKE '%...%'` с шаблоном без привязки к началу строки —
поиск подстроки был и остаётся полным сканированием таблицы, просто
незаметным, пока устройств не тысячи.

GIN-индекс по триграммам (`pg_trgm`) решает обе проблемы разом: он строится
поверх ровно того выражения, что использует запрос (иначе планировщик его
не увидит), и ускоряет именно поиск подстроки, а не только префикса.
`gin_trgm_ops` — часть pg_trgm, доступной в contrib почти любого
распространения PostgreSQL, включая управляемые облачные.

Индексы поставлены на mac/management_ip у устройств и mac/ip у интерфейсов
— это ровно те четыре колонки, что участвуют в поиске по железному адресу.
Код и название устройства сюда не попали: у них не было такой же явной
жалобы в отчёте, а с ростом объёма это отдельная правка.
"""

from alembic import op

revision = "0021_search_trgm_indexes"
down_revision = "0020_import_row_mac"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX ix_devices_mac_trgm ON devices "
        "USING gin (replace(mac::text, ':', '') gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_devices_management_ip_trgm ON devices "
        "USING gin ((management_ip::text) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_interfaces_mac_trgm ON interfaces "
        "USING gin (replace(mac::text, ':', '') gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_interfaces_ip_trgm ON interfaces "
        "USING gin ((ip::text) gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_interfaces_ip_trgm")
    op.execute("DROP INDEX IF EXISTS ix_interfaces_mac_trgm")
    op.execute("DROP INDEX IF EXISTS ix_devices_management_ip_trgm")
    op.execute("DROP INDEX IF EXISTS ix_devices_mac_trgm")
    # Расширение не трогаем: другие объекты могли начать на него полагаться.
