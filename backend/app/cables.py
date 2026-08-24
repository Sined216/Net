"""Что делать с кабелем, когда порт исчезает.

Порт можно убрать (сняли сетевую карту, вычеркнули порт из модели), а
кабель при этом никуда не девается — он остаётся проложенным, у него
просто повисает конец. Но если снимают последний оставшийся конец, кабель
перестаёт быть где-либо задокументированным: он никуда не воткнут и найти
его в спецификации больше нельзя. Такую запись нужно удалять — база её и
не примет, у связи обязан быть хотя бы один конец.
"""

from collections.abc import Iterable

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models


def drop_cables_without_ends(db: Session, interface_ids: Iterable[int]) -> int:
    """Удалить кабели, у которых после снятия этих портов не остаётся концов.

    Возвращает число удалённых кабелей. Остальные кабели не трогаются — их
    концы сами обнулятся при удалении порта (ON DELETE SET NULL).
    """
    ids = set(interface_ids)
    if not ids:
        return 0

    links = db.query(models.Link).filter(
        or_(models.Link.interface_a_id.in_(ids), models.Link.interface_b_id.in_(ids))
    ).all()

    def is_lost(end: int | None) -> bool:
        # Конец либо уже повис, либо повиснет сейчас вместе с портом.
        return end is None or end in ids

    doomed = [link.id for link in links if is_lost(link.interface_a_id) and is_lost(link.interface_b_id)]
    if not doomed:
        return 0

    return db.query(models.Link).filter(models.Link.id.in_(doomed)).delete(synchronize_session=False)
