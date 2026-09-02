"""Настраиваемая политика паролей.

Минимальная длина была жёстко зашита в схеме (`schemas.MIN_PASSWORD_LENGTH`)
— поменять её означало менять код и пересобирать образ. Выносим в таблицу:
одна строка на всю систему, редактируется администратором через
`/settings/password-policy` (см. `app/routers/settings.py`).

Значение по умолчанию (12, без срока действия) совпадает с прежним
поведением — накатка миграции никого не запирает.

Заодно у `users` появляется `password_changed_at`: без него принудительную
смену по сроку не с чем сравнивать. У существующих строк берём `created_at`
— точный момент последней смены до этой миграции никто не записывал, а
«пароль не менялся с создания учётки» — не худшее приближение к правде.
"""

from alembic import op
import sqlalchemy as sa

revision = "0024_password_policy"
down_revision = "0023_field_survey_staging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_policy",
        sa.Column("id", sa.Integer(), primary_key=True, server_default="1"),
        sa.Column("min_length", sa.Integer(), nullable=False, server_default="12"),
        sa.Column("max_age_days", sa.Integer()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("id = 1", name="ck_password_policy_singleton"),
        sa.CheckConstraint("min_length BETWEEN 8 AND 128", name="ck_password_policy_min_length"),
    )
    op.execute("INSERT INTO password_policy (id, min_length, max_age_days) VALUES (1, 12, NULL)")

    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE users SET password_changed_at = created_at")


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
    op.drop_table("password_policy")
