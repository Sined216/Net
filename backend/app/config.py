"""Конфигурация приложения в одном месте.

Раньше настройки читались через `os.getenv` по месту использования, и у
`SECRET_KEY` был тихий дефолт: приложение поднималось в проде «безопасно
выглядящим», хотя токены подделывались кем угодно. Теперь настройки
собраны здесь и в продовом режиме проверяются на старте — лучше не
запуститься с внятным сообщением, чем работать дырявым.
"""

from typing import Literal

from pydantic import ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Значения, которые кочуют из примеров конфигов и README и потому не должны
# доживать до продуктива.
INSECURE_SECRET_KEYS = {
    "",
    "change-me-in-production",
    "change-me",
    "changeme",
    "secret",
    "test-secret-key",
    "ci-secret-key",
}

MIN_SECRET_KEY_LENGTH = 32

_HOW_TO_GENERATE = 'python -c "import secrets; print(secrets.token_urlsafe(48))"'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    environment: Literal["development", "production"] = "development"

    database_url: str = "postgresql://netdoc:netdoc@localhost:5432/netdoc"

    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 12

    # Список origin через запятую. Звёздочка в продуктиве запрещена — с ней
    # API открыт любому сайту, который откроет сотрудник.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "change-me-please"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _reject_insecure_production_config(self) -> "Settings":
        if not self.is_production:
            return self

        problems = []
        key = self.secret_key.strip()
        if key.lower() in INSECURE_SECRET_KEYS:
            problems.append(
                f"SECRET_KEY оставлен значением по умолчанию. Сгенерируйте свой: {_HOW_TO_GENERATE}"
            )
        elif len(key) < MIN_SECRET_KEY_LENGTH:
            problems.append(
                f"SECRET_KEY короче {MIN_SECRET_KEY_LENGTH} символов — такой ключ подбирается. "
                f"Сгенерируйте новый: {_HOW_TO_GENERATE}"
            )

        origins = self.cors_origin_list
        if not origins:
            problems.append("CORS_ORIGINS пуст — укажите адреса, с которых открывается интерфейс")
        elif "*" in origins:
            problems.append(
                "CORS_ORIGINS='*' в продуктиве недопустим — перечислите конкретные адреса через запятую"
            )

        if problems:
            raise ValueError(
                "Небезопасная конфигурация при ENVIRONMENT=production:\n  - " + "\n  - ".join(problems)
            )
        return self


try:
    settings = Settings()
except ValidationError as exc:
    # Наружу отдаём только сам текст проблемы: в логе контейнера трассировка
    # pydantic поверх «смените SECRET_KEY» только мешает читать.
    reasons = "\n".join(str(error["msg"]).removeprefix("Value error, ") for error in exc.errors())
    raise SystemExit(f"NetDoc не запущен — проверьте настройки.\n{reasons}") from None
