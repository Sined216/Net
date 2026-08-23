"""Обход с телефона: снимок в цех и записи обратно.

Две ручки, обе про одно — телефон в цеху без сети, а сверять и дополнять
спецификацию надо на месте:

- `GET /sync/snapshot` — всё по площадке одним ответом, чтобы унести с
  собой. Отдаётся теми же схемами, что и обычные ручки: телефон показывает
  ту же спецификацию, что и веб.
- `POST /sync/upload` — то, что нашлось в цеху, обратно. **Не** в
  спецификацию: записи ложатся в промежуточные таблицы (`import_rows`,
  `import_link_rows`) и ждут, пока человек перенесёт их по одной. Ровно тот
  же порядок, что у импорта из файла, и по той же причине — в поле пишут
  «свитч у окна, третий порт», и превратить это в запись базы может только
  человек, глядя на то, что уже заведено.

Выгрузка идемпотентна по `client_uuid`, который телефон выдаёт записи ещё
оффлайн: связь по дороге рвётся, телефон не дожидается ответа и шлёт пакет
заново — без ключа каждое повторение задваивало бы записи. Повтор здесь не
ошибка, а обычный исход: сервер отвечает, сколько записей приняты впервые,
а сколько уже были, и перечисляет принятые ключи — по ним телефон чистит
свою очередь.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app import auth, models, schemas, sites
from app.database import get_db

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/snapshot", response_model=schemas.SyncSnapshot)
def snapshot(db: Session = Depends(get_db),
             _: models.User = Depends(auth.get_current_user),
             site_id: int = Depends(sites.current_site_id)):
    """Снимок площадки для оффлайна.

    Доступ — как у чтения: унести спецификацию с собой может любая роль,
    это то же самое, что открыть её в браузере. Правки требуют `can_edit`,
    но они и приезжают отдельной ручкой ниже.
    """
    site = db.query(models.Site).filter(models.Site.id == site_id).one()

    devices = (
        db.query(models.Device)
        .options(joinedload(models.Device.interfaces), joinedload(models.Device.tags))
        .filter(models.Device.site_id == site_id)
        .order_by(models.Device.code)
        .all()
    )
    links = (
        db.query(models.Link)
        .filter(models.Link.site_id == site_id)
        .order_by(models.Link.id)
        .all()
    )
    templates = (
        db.query(models.DeviceTemplate)
        .options(
            joinedload(models.DeviceTemplate.interfaces),
            joinedload(models.DeviceTemplate.device_type),
        )
        .order_by(models.DeviceTemplate.name)
        .all()
    )

    return schemas.SyncSnapshot(
        site_id=site_id,
        site_name=site.name,
        taken_at=datetime.now(timezone.utc),
        devices=[schemas.DeviceOut.model_validate(d) for d in devices],
        links=[schemas.LinkOut.model_validate(link) for link in links],
        # Справочники — общие для всех площадок, кроме тех, у кого своя
        # площадка есть (VLAN, теги, группы): их фильтруем, остальные нет.
        templates=[schemas.DeviceTemplateOut.model_validate(t) for t in templates],
        device_types=[
            schemas.DeviceTypeOut.model_validate(t)
            for t in db.query(models.DeviceType).order_by(models.DeviceType.name)
        ],
        connector_types=[
            schemas.ConnectorTypeOut.model_validate(c)
            for c in db.query(models.ConnectorType).order_by(models.ConnectorType.name)
        ],
        vlans=[
            schemas.VlanOut.model_validate(v)
            for v in db.query(models.Vlan).filter(models.Vlan.site_id == site_id)
            .order_by(models.Vlan.vlan_number)
        ],
        tags=[
            schemas.TagOut.model_validate(t)
            for t in db.query(models.Tag).filter(models.Tag.site_id == site_id)
            .order_by(models.Tag.name)
        ],
        groups=[
            schemas.TopologyGroupOut.model_validate(g)
            for g in db.query(models.TopologyGroup).filter(models.TopologyGroup.site_id == site_id)
            .order_by(models.TopologyGroup.name)
        ],
    )


@router.post("/upload", response_model=schemas.SyncUploadResult)
def upload(payload: schemas.SyncUploadRequest, db: Session = Depends(get_db),
           user: models.User = Depends(auth.can_edit),
           site_id: int = Depends(sites.current_site_id)):
    """Записи из обхода — в промежуточные таблицы, не в спецификацию.

    Идемпотентно: запись с уже принятым `client_uuid` не заводится второй
    раз, но и ошибкой не считается — телефон узнаёт её в `accepted_uuids`
    и убирает у себя из очереди.
    """
    device_uuids = [d.client_uuid for d in payload.devices]
    link_uuids = [link.client_uuid for link in payload.links]

    # Что из присланного уже принято раньше. Одним запросом на таблицу, а
    # не проверкой на каждую запись: пакет с обхода — это сотни строк.
    known_devices = {
        uuid for (uuid,) in db.query(models.ImportRow.client_uuid).filter(
            models.ImportRow.client_uuid.in_(device_uuids or [""]),
        )
    }
    known_links = {
        uuid for (uuid,) in db.query(models.ImportLinkRow.client_uuid).filter(
            models.ImportLinkRow.client_uuid.in_(link_uuids or [""]),
        )
    }

    devices_added = 0
    # Внутри самого пакета ключ тоже может повториться — телефон мог
    # склеить две очереди. Считаем такой повтор тем же, чем и повтор между
    # пакетами, иначе на уникальном индексе упала бы вся выгрузка.
    seen: set = set()
    for item in payload.devices:
        if item.client_uuid in known_devices or item.client_uuid in seen:
            continue
        seen.add(item.client_uuid)
        db.add(models.ImportRow(
            site_id=site_id, source="mobile", client_uuid=item.client_uuid,
            name=item.name, template_name=item.template_name, type_name=item.type_name,
            management_ip=item.management_ip, mac=item.mac, notes=item.notes,
            group_name=item.group_name, tags_text=item.tags_text, extra=item.extra,
            status="new", imported_by=user.id,
        ))
        devices_added += 1

    links_added = 0
    seen_links: set = set()
    for item in payload.links:
        if item.client_uuid in known_links or item.client_uuid in seen_links:
            continue
        seen_links.add(item.client_uuid)
        db.add(models.ImportLinkRow(
            site_id=site_id, source="mobile", client_uuid=item.client_uuid,
            a_device_text=item.a_device_text, a_port_text=item.a_port_text,
            b_device_text=item.b_device_text, b_port_text=item.b_port_text,
            # Ссылка на устройство принимается, только если оно и вправду с
            # этой площадки: телефон мог принести номер из чужого снимка.
            a_device_id=_device_on_site(db, item.a_device_id, site_id),
            b_device_id=_device_on_site(db, item.b_device_id, site_id),
            medium=item.medium, notes=item.notes, extra=item.extra,
            status="new", imported_by=user.id,
        ))
        links_added += 1

    db.commit()

    return schemas.SyncUploadResult(
        devices_added=devices_added,
        devices_duplicate=len(payload.devices) - devices_added,
        links_added=links_added,
        links_duplicate=len(payload.links) - links_added,
        accepted_uuids=device_uuids + link_uuids,
    )


def _device_on_site(db: Session, device_id: int | None, site_id: int) -> int | None:
    """Номер устройства, если оно есть и на этой площадке. Иначе пусто —
    запись обхода от этого не пропадает, просто при переносе устройство
    придётся выбрать руками."""
    if device_id is None:
        return None
    found = db.query(models.Device.id).filter(
        models.Device.id == device_id, models.Device.site_id == site_id,
    ).first()
    return found[0] if found else None
