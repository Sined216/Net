"""MAC-адрес в строке импорта.

До сих пор столбец MAC из файла падал в `extra` вместе с инвентарным
номером и серийником — как «ещё из файла», не как поле устройства. Модель
это позволяла: MAC был известен только на самом устройстве. Раз MAC теперь
можно ввести на импорте так же, как IP, ему нужна колонка в промежуточной
таблице.

Текстом, как и остальные поля строки импорта: MAC отсюда переносится в форму
устройства, где и проверяется/нормализуется — здесь же строка хранится как
есть, разбор нестрогий.
"""

from alembic import op
import sqlalchemy as sa

revision = "0020_import_row_mac"
down_revision = "0019_group_cabinet"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("import_rows", sa.Column("mac", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("import_rows", "mac")
