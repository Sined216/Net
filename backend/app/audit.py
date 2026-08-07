import json
from typing import Optional
from sqlalchemy.orm import Session
from app import models


def _to_jsonable(obj) -> Optional[dict]:
    if obj is None:
        return None
    if isinstance(obj, dict):
        data = obj
    else:
        data = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
    return json.loads(json.dumps(data, default=str))


def log_change(db: Session, user_id: Optional[int], action: str, entity_type: str,
                entity_id: Optional[int], old=None, new=None):
    entry = models.AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=_to_jsonable(old),
        new_value=_to_jsonable(new),
    )
    db.add(entry)
