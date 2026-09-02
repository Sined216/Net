"""Адрес принтера этикеток — читается из базы, не из конфигурации.

Тот же приём, что у `app/password_policy.py`: единственная строка,
`get_settings()` подстраховывает случай, когда её почему-то нет (не
рабочий путь, только защита от пустой таблицы).
"""

from sqlalchemy.orm import Session

from app import models

DEFAULT_PORT = 9100


def get_settings(db: Session) -> models.PrinterSettings:
    settings = db.get(models.PrinterSettings, 1)
    if settings is not None:
        return settings
    return models.PrinterSettings(id=1, host=None, port=DEFAULT_PORT, version=1)
