"""Нумерация портов: всегда 1, 2, 3… подряд, без пропусков.

Номер порта — это не произвольная метка, а место в ряду гнёзд: у
двадцатичетырёхпортового коммутатора номера идут от 1 до 24, и дырки в
этом ряду означали бы гнездо, которого нет. Поэтому номера не вводятся
руками, а раздаются здесь: новый порт встаёт в конец, а после удаления
оставшиеся сдвигаются, чтобы ряд снова был сплошным.

Сдвиг делается в два приёма. Уникальность номера база проверяет на каждой
строке отдельно, а не в конце запроса, поэтому «прибавить всем единицу»
одним UPDATE нельзя — на середине номер совпал бы с соседним. Сначала все
номера уводятся за пределы занятого диапазона, и только потом получают
окончательные значения.

Всё считается сразу для набора устройств, а не по одному: порт, добавленный
модели, доезжает до каждого её экземпляра, и на тысяче станков поштучные
запросы складывались в минуты ожидания.
"""

from collections.abc import Iterable

from sqlalchemy import func, text
from sqlalchemy.orm import Session


def _max_number(db: Session, model, owner_column: str, owner_ids: list[int]) -> int:
    """Самый большой номер во всём наборе — им же и сдвигаем."""
    if not owner_ids:
        return 0
    return db.query(func.coalesce(func.max(model.port_number), 0)).filter(
        getattr(model, owner_column).in_(owner_ids)
    ).scalar() or 0


def next_number(db: Session, model, owner_column: str, owner_id: int) -> int:
    """Номер для нового порта — следующий за последним."""
    db.flush()
    return _max_number(db, model, owner_column, [owner_id]) + 1


def make_room(db: Session, model, owner_column: str, owner_ids: int | Iterable[int], number: int) -> None:
    """Освободить номер: порты с этого места и дальше уводятся вверх.

    Нужно, когда порт вставляется не в конец — например модели дописали
    порт, а у устройства к её портам добавлены свои: порт модели должен
    встать сразу за портами модели, а не за самодельными.
    Ряд после этого разреженный — вызывающий обязан закончить `renumber`.
    """
    ids = _as_list(owner_ids)
    if not ids:
        return
    db.flush()
    offset = _max_number(db, model, owner_column, ids)
    if offset == 0:
        return
    db.execute(
        text(
            f"UPDATE {model.__tablename__} SET port_number = port_number + :offset "
            f"WHERE {owner_column} = ANY(:owners) AND port_number >= :number"
        ),
        {"offset": offset, "owners": ids, "number": number},
    )
    db.expire_all()


def renumber(db: Session, model, owner_column: str, owner_ids: int | Iterable[int]) -> None:
    """Пересобрать ряд номеров в сплошной 1..N, сохранив порядок портов.

    Считается сразу для всех переданных устройств: нумерация у каждого своя
    (PARTITION BY), но запросов всё равно два, а не два на устройство.
    """
    ids = _as_list(owner_ids)
    if not ids:
        return
    db.flush()
    table = model.__tablename__
    offset = _max_number(db, model, owner_column, ids)
    if offset == 0:
        return
    params = {"owners": ids, "offset": offset}
    db.execute(
        text(f"UPDATE {table} SET port_number = port_number + :offset WHERE {owner_column} = ANY(:owners)"),
        params,
    )
    db.execute(
        text(
            f"""
            WITH ordered AS (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY {owner_column} ORDER BY port_number, id) AS number
                FROM {table}
                WHERE {owner_column} = ANY(:owners)
            )
            UPDATE {table} AS t
            SET port_number = ordered.number
            FROM ordered
            WHERE t.id = ordered.id
            """
        ),
        params,
    )
    db.expire_all()


def _as_list(owner_ids: int | Iterable[int]) -> list[int]:
    if isinstance(owner_ids, int):
        return [owner_ids]
    return list(owner_ids)
