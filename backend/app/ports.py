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
"""

from sqlalchemy import func, text
from sqlalchemy.orm import Session


def _max_number(db: Session, model, owner_column: str, owner_id: int) -> int:
    return db.query(func.coalesce(func.max(model.port_number), 0)).filter(
        getattr(model, owner_column) == owner_id
    ).scalar() or 0


def next_number(db: Session, model, owner_column: str, owner_id: int) -> int:
    """Номер для нового порта — следующий за последним."""
    db.flush()
    return _max_number(db, model, owner_column, owner_id) + 1


def make_room(db: Session, model, owner_column: str, owner_id: int, number: int) -> None:
    """Освободить номер: порты с этого места и дальше уводятся вверх.

    Нужно, когда порт вставляется не в конец — например модели дописали
    порт, а у устройства к её портам добавлены свои: порт модели должен
    встать сразу за портами модели, а не за самодельными.
    Ряд после этого разреженный — вызывающий обязан закончить `renumber`.
    """
    db.flush()
    offset = _max_number(db, model, owner_column, owner_id)
    if offset == 0:
        return
    db.execute(
        text(
            f"UPDATE {model.__tablename__} SET port_number = port_number + :offset "
            f"WHERE {owner_column} = :owner AND port_number >= :number"
        ),
        {"offset": offset, "owner": owner_id, "number": number},
    )
    db.expire_all()


def renumber(db: Session, model, owner_column: str, owner_id: int) -> None:
    """Пересобрать ряд номеров в сплошной 1..N, сохранив порядок портов."""
    db.flush()
    table = model.__tablename__
    offset = _max_number(db, model, owner_column, owner_id)
    if offset == 0:
        return
    params = {"owner": owner_id, "offset": offset}
    db.execute(
        text(f"UPDATE {table} SET port_number = port_number + :offset WHERE {owner_column} = :owner"),
        params,
    )
    db.execute(
        text(
            f"""
            WITH ordered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY port_number, id) AS number
                FROM {table}
                WHERE {owner_column} = :owner
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
