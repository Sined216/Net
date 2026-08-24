"""MAC-адрес устройства.

MAC до сих пор был только у порта, и это верно для железки с несколькими
интерфейсами: у каждого гнезда свой адрес. Но у коммутатора есть и
собственный, управляющий MAC — тот, по которому железку ищут в таблицах
коммутации соседей, и он не привязан ни к какому конкретному порту.

Тип нативный (MACADDR), как у порта: база сама отвергает мусор и приводит
запись к одному виду — «A4-BB-6D-11-22-33» и «a4bb.6d11.2233» лягут
одинаково, и поиск по адресу не зависит от того, из чьей выгрузки его
скопировали.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import MACADDR

revision = "0017_device_mac"
down_revision = "0016_optimistic_locking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("mac", MACADDR(), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "mac")
