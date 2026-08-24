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


def sync_sequences(db: Session) -> None:
    """Подтянуть счётчики кодов к уже заведённым устройствам.

    Счётчик и коды живут в разных таблицах, и разъехаться они могут не по
    вине приложения: базу восстановили из дампа, сделанного без
    `code_sequences`, или устройства залили прямым SQL. Тогда следующий код
    оказывается уже занятым, устройство не заводится, и починить это из
    интерфейса нельзя.

    Проверка при каждом старте стоит один запрос и делает такую поломку
    невозможной: счётчик двигается только вперёд, до максимума фактических
    кодов, и никогда назад.
    """
    db.execute(
        text(
            """
            INSERT INTO code_sequences (prefix, next_value)
            SELECT regexp_replace(code, '-[0-9]+$', ''),
                   MAX((substring(code from '[0-9]+$'))::int) + 1
              FROM devices
             WHERE code ~ '-[0-9]+$'
             GROUP BY regexp_replace(code, '-[0-9]+$', '')
            ON CONFLICT (prefix) DO UPDATE
               SET next_value = GREATEST(code_sequences.next_value, EXCLUDED.next_value)
            """
        )
    )
    db.commit()
