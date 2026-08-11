import json
from typing import Optional

from sqlalchemy.orm import Session

from app import models

# Поля, которые в журнале только шумят: их меняет сама база на каждой
# записи, и «updated_at: было → стало» ничего не сообщает.
NOISY_FIELDS = {"updated_at", "created_at", "password_hash", "topology_x", "topology_y",
                # Номер правки — служебный счётчик, а не содержание записи.
                "version"}


def _to_jsonable(obj) -> Optional[dict]:
    if obj is None:
        return None
    if isinstance(obj, dict):
        data = obj
    else:
        data = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
    return json.loads(json.dumps(data, default=str))


def _site_of(*candidates) -> Optional[int]:
    """Площадка записи — из самого изменённого объекта.

    Так её не нужно передавать на каждом вызове: у всего, что принадлежит
    площадке, поле site_id и так есть — и в модели, и в снимке столбцов. У
    общих справочников его нет, и запись остаётся без площадки, то есть
    видной всем.
    """
    for candidate in candidates:
        if candidate is None:
            continue
        value = candidate.get("site_id") if isinstance(candidate, dict) else getattr(candidate, "site_id", None)
        if isinstance(value, int):
            return value
    return None


def _nothing_changed(action: str, old, new) -> bool:
    """Правка, которая ничего не поменяла, в журнал не пишется.

    Форма устройства сохраняет и свойства, и теги — двумя запросами, и
    обычно один из них не меняет ничего. Такая запись в журнале только
    мешает: человек видит «правка» и не находит, что же поправили.
    """
    if action != "update":
        return False
    before, after = _to_jsonable(old) or {}, _to_jsonable(new) or {}
    fields = set(before) | set(after)
    return all(before.get(f) == after.get(f) for f in fields - NOISY_FIELDS)


def log_change(db: Session, user_id: Optional[int], action: str, entity_type: str,
                entity_id: Optional[int], old=None, new=None, site_id: Optional[int] = None):
    if _nothing_changed(action, old, new):
        return
    entry = models.AuditLog(
        site_id=site_id if site_id is not None else _site_of(new, old),
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=_to_jsonable(old),
        new_value=_to_jsonable(new),
    )
    db.add(entry)
