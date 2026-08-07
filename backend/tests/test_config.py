"""Продовая конфигурация проверяется на старте: лучше не подняться с внятным
сообщением, чем работать с подделываемыми токенами."""

import pytest

from app.config import Settings

GOOD_KEY = "s7Qe1nR4xUv0Pm2Kd9Lb3Wt6Yz8Ac5Jf1Hg4Nq7Ru0Sv"
GOOD_ORIGINS = "https://netdoc.example.local"


def _settings(**overrides):
    base = {
        "environment": "production",
        "secret_key": GOOD_KEY,
        "cors_origins": GOOD_ORIGINS,
        "_env_file": None,  # не подхватывать .env разработчика
    }
    return Settings(**{**base, **overrides})


def test_valid_production_config_is_accepted():
    settings = _settings()
    assert settings.is_production
    assert settings.cors_origin_list == [GOOD_ORIGINS]


def test_default_secret_key_is_rejected_in_production():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        _settings(secret_key="change-me-in-production")


def test_short_secret_key_is_rejected_in_production():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        _settings(secret_key="слишком-короткий")


def test_wildcard_cors_is_rejected_in_production():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        _settings(cors_origins="*")


def test_empty_cors_is_rejected_in_production():
    with pytest.raises(ValueError, match="CORS_ORIGINS"):
        _settings(cors_origins="   ")


def test_development_tolerates_defaults():
    """В разработке те же значения проходят: локальный запуск не должен
    требовать генерации ключа."""
    settings = Settings(environment="development", secret_key="change-me-in-production",
                        cors_origins="*", _env_file=None)
    assert not settings.is_production


def test_cors_origins_are_split_and_trimmed():
    settings = Settings(cors_origins=" http://a.local , http://b.local ,, ", _env_file=None)
    assert settings.cors_origin_list == ["http://a.local", "http://b.local"]
