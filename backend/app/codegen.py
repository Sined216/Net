from sqlalchemy import text
from sqlalchemy.orm import Session


def next_device_code(db: Session, prefix: str) -> str:
    """Атомарно выдаёт следующий код для устройства данного типа, например
    SW-0001, SW-0002... Использует INSERT ... ON CONFLICT, чтобы не ловить
    гонку при параллельных запросах (в отличие от "найти максимум и
    прибавить единицу" в Python)."""
    row = db.execute(
        text(
            """
            INSERT INTO code_sequences (prefix, next_value) VALUES (:prefix, 2)
            ON CONFLICT (prefix) DO UPDATE SET next_value = code_sequences.next_value + 1
            RETURNING next_value - 1
            """
        ),
        {"prefix": prefix},
    ).first()
    return f"{prefix}-{row[0]:04d}"
