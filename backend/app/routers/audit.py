"""Журнал изменений — чтение.

Писался он давно, а прочитать было неоткуда. Доступен всем ролям, включая
`viewer`: кто и что менял — рабочая информация, а не секрет, и вопрос «кто
переставил станок в другой цех» обычно возникает как раз у того, кто сам
править не может.

Записи площадки видны только на своей площадке; записи об общих
справочниках (модели техники, разъёмы, пресеты кабелей) и о людях — везде,
потому что и сами справочники общие.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import auth, models, schemas, sites
from app.database import get_db

router = APIRouter(prefix="/audit", tags=["audit"])

# Что менялось — по-русски. Незнакомое показывается как есть: журнал не
# должен молчать только оттого, что в нём появилась новая сущность.
ENTITY_LABELS = {
    "device": "Устройство",
    "interface": "Порт",
    "link": "Кабель",
    "device_template": "Модель техники",
    "device_type": "Тип устройства",
    "link_template": "Шаблон связи",
    "connector_type": "Разъём",
    "transceiver_module": "Модуль",
    "tag": "Тег",
    "vlan": "VLAN",
    "topology_group": "Группа топологии",
    "site": "Площадка",
    "user": "Пользователь",
    "import": "Импорт",
}

FIELD_LABELS = {
    "name": "название",
    "code": "код",
    "management_ip": "IP управления",
    "role": "роль",
    "install_date": "дата установки",
    "notes": "заметки",
    "template_id": "модель",
    "device_type_id": "тип",
    "topology_group_id": "группа",
    "tags": "теги",
    "label": "название порта",
    "port_number": "номер порта",
    "connector_id": "разъём",
    "module_id": "модуль",
    "mode": "режим",
    "vlan_id": "VLAN",
    "ip": "IP",
    "mac": "MAC",
    "interface_a_id": "конец A",
    "interface_b_id": "конец B",
    "length_m": "длина, м",
    "speed_mbps": "скорость, Мбит/с",
    "connector_type": "разъём кабеля",
    "confirmed": "подтверждена",
    "color": "цвет",
    "line_style": "стиль линии",
    "media_type": "среда",
    "cable_category": "категория кабеля",
    "code_prefix": "префикс кода",
    "vlan_number": "номер VLAN",
    "subnet": "подсеть",
    "gateway": "шлюз",
    "parent_id": "родитель",
    "username": "логин",
    "full_name": "имя",
    "is_active": "активен",
    "ports_editable_on_device": "порты правятся на устройстве",
}

# Не показываем: их меняет сама база на каждой записи либо это внутреннее
# состояние, за которым человек в журнал не приходит.
HIDDEN_FIELDS = {"id", "created_at", "updated_at", "created_by", "updated_by",
                 "password_hash", "must_change_password", "topology_x", "topology_y",
                 "last_seen_at", "source",
                 # Номер правки — служебный счётчик оптимистичной блокировки,
                 # а не содержание записи.
                 "version",
                 # Площадка у записи и так одна — та, в которой человек
                 # работает; в списке правок она только шумит.
                 "site_id"}


def _text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "да" if value else "нет"
    return str(value)


def _changes(action: str, old: dict | None, new: dict | None) -> list[schemas.AuditChange]:
    """Разница между снимками — то, ради чего в журнал и заходят.

    При создании показывается заполненное, при удалении — что было, при
    правке — только поля, которые действительно поменялись.
    """
    old = old or {}
    new = new or {}
    fields = [f for f in (new if action != "delete" else old) if f not in HIDDEN_FIELDS]

    result = []
    for field in fields:
        before, after = old.get(field), new.get(field)
        if action == "update" and before == after:
            continue
        if action == "create" and (after is None or after == "" or after == []):
            continue
        result.append(schemas.AuditChange(
            field=field,
            label=FIELD_LABELS.get(field, field),
            old=_text(before) if action != "create" else None,
            new=_text(after) if action != "delete" else None,
        ))
    return result


@router.get("", response_model=schemas.AuditPage)
def list_audit(
    entity_type: str | None = None,
    entity_id: int | None = None,
    user_id: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    site_id: int = Depends(sites.current_site_id),
    _: models.User = Depends(auth.get_current_user),
):
    """Записи журнала, свежие сверху."""
    query = (
        db.query(models.AuditLog, models.User.full_name)
        .outerjoin(models.User, models.User.id == models.AuditLog.user_id)
        # Записи без площадки — про общие справочники и про людей; они
        # одинаковы для всех и прятать их не от кого.
        .filter(or_(models.AuditLog.site_id == site_id, models.AuditLog.site_id.is_(None)))
    )
    if entity_type:
        query = query.filter(models.AuditLog.entity_type == entity_type)
    if entity_id is not None:
        query = query.filter(models.AuditLog.entity_id == entity_id)
    if user_id is not None:
        query = query.filter(models.AuditLog.user_id == user_id)
    if since is not None:
        query = query.filter(models.AuditLog.created_at >= since)
    if until is not None:
        query = query.filter(models.AuditLog.created_at <= until)

    total = query.count()
    rows = query.order_by(models.AuditLog.id.desc()).limit(limit).offset(offset).all()

    items = [
        schemas.AuditEntryOut(
            id=entry.id,
            action=entry.action,
            entity_type=entry.entity_type,
            entity_label=ENTITY_LABELS.get(entry.entity_type, entry.entity_type),
            entity_id=entry.entity_id,
            user_id=entry.user_id,
            user_name=user_name,
            created_at=entry.created_at,
            changes=_changes(entry.action, entry.old_value, entry.new_value),
        )
        for entry, user_name in rows
    ]
    return schemas.AuditPage(items=items, total=total)
