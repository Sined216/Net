"""Заведение устройства по шаблону.

Правило одно: у экземпляра модели порты те же, что у самой модели, — с теми
же номерами, названиями и разъёмами, и со ссылкой на порт модели, по которой
потом доезжают её правки. Код выдаётся по префиксу типа устройства.

Вынесено из маршрутов, потому что заводят устройства из двух мест — руками
и переносом строки импорта, — и раньше эти два места повторяли одно и то же
дословно. Они уже начали расходиться: перенос из импорта писал в журнал
запись без идентификатора устройства, и в истории самой железки её
появление не показывалось.

Сюда же будет обращаться опрос сети из этапа 4: обнаруженное устройство
должно заводиться теми же правилами, что и заведённое человеком, а не своей
копией этого кода.
"""

from sqlalchemy.orm import Session

from app import models
from app.codegen import next_device_code


def create_device(db: Session, *, template: models.DeviceTemplate, site_id: int,
                   user_id: int, data: dict, tags: list[models.Tag] | None = None) -> models.Device:
    """Завести устройство по шаблону вместе с его портами.

    Возвращает устройство уже с `id` (после flush), но не коммитит: вызвавший
    маршрут может дописать в ту же транзакцию своё — например пометить
    строку импорта перенесённой.
    """
    device = models.Device(
        template_id=template.id,
        site_id=site_id,
        code=next_device_code(db, template.device_type.code_prefix),
        created_by=user_id,
        tags=tags or [],
        **data,
    )
    db.add(device)
    db.flush()  # нужен device.id: порты ссылаются на него

    for tpl_iface in template.interfaces:
        db.add(models.Interface(
            device_id=device.id, site_id=site_id, port_number=tpl_iface.port_number,
            label=tpl_iface.label, connector_id=tpl_iface.connector_id,
            template_interface_id=tpl_iface.id,
        ))
    return device
