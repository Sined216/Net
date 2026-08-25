"""Обход с телефона: снимок в цех и записи обратно (/sync).

Главное, что здесь проверяется, — обещание, ради которого всё и сделано:
записи из обхода **не** попадают в спецификацию оборудования, а ложатся в
промежуточные таблицы и ждут ручного переноса. Плюс идемпотентность
выгрузки: телефон в цеху без сети, пакет по дороге теряется и уходит
заново, и повтор не должен задваивать.
"""

from app import models


def test_snapshot_available_to_viewer(client, headers):
    """Снимок — это чтение: унести спецификацию с собой может любая роль."""
    response = client.get("/sync/snapshot", headers=headers["viewer"])
    assert response.status_code == 200
    body = response.json()
    assert body["site_name"] == "Тестовая площадка"
    assert body["taken_at"]


def test_snapshot_requires_auth(client):
    assert client.get("/sync/snapshot").status_code == 401


def test_upload_denied_to_viewer(client, headers):
    """Выгрузка — правка: смотрящему недоступна, как и всё остальное на
    этом уровне прав."""
    response = client.post(
        "/sync/upload",
        json={"devices": [{"client_uuid": "u1", "name": "нельзя"}], "links": []},
        headers=headers["viewer"],
    )
    assert response.status_code == 403


def test_upload_lands_in_staging_not_in_specification(client, headers, db):
    """То самое обещание: в спецификации после выгрузки пусто, всё в
    промежуточных таблицах со статусом «ждёт переноса»."""
    response = client.post(
        "/sync/upload",
        json={
            "devices": [
                {"client_uuid": "dev-1", "name": "Свитч у окна", "template_name": "Cisco 2960"},
                {"client_uuid": "dev-2", "name": "Камера над воротами"},
            ],
            "links": [
                {
                    "client_uuid": "lnk-1",
                    "a_device_text": "Свитч у окна", "a_port_text": "3",
                    "b_device_text": "Камера над воротами", "b_port_text": "eth0",
                },
            ],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["devices_added"] == 2
    assert body["links_added"] == 1
    assert body["devices_duplicate"] == 0
    assert body["links_duplicate"] == 0
    assert set(body["accepted_uuids"]) == {"dev-1", "dev-2", "lnk-1"}

    # Спецификация не тронута — ради этого промежуточные таблицы и заведены.
    assert db.query(models.Device).count() == 0
    assert db.query(models.Link).count() == 0

    rows = db.query(models.ImportRow).order_by(models.ImportRow.client_uuid).all()
    assert [r.client_uuid for r in rows] == ["dev-1", "dev-2"]
    assert all(r.source == "mobile" and r.status == "new" for r in rows)
    # Файловые поля у обхода пусты — файла у него нет.
    assert all(r.source_file is None and r.row_number is None for r in rows)

    link_rows = db.query(models.ImportLinkRow).all()
    assert len(link_rows) == 1
    assert link_rows[0].a_port_text == "3"
    assert link_rows[0].status == "new"


def test_upload_is_idempotent(client, headers, db):
    """Связь оборвалась, телефон шлёт пакет заново — повтор не задваивает,
    но и ошибкой не считается: ключи по-прежнему числятся принятыми, чтобы
    телефон очистил свою очередь."""
    packet = {
        "devices": [{"client_uuid": "dev-1", "name": "Свитч у окна"}],
        "links": [{"client_uuid": "lnk-1", "a_device_text": "Свитч", "a_port_text": "1"}],
    }
    first = client.post("/sync/upload", json=packet, headers=headers["editor"]).json()
    assert (first["devices_added"], first["links_added"]) == (1, 1)

    second = client.post("/sync/upload", json=packet, headers=headers["editor"]).json()
    assert (second["devices_added"], second["links_added"]) == (0, 0)
    assert (second["devices_duplicate"], second["links_duplicate"]) == (1, 1)
    assert set(second["accepted_uuids"]) == {"dev-1", "lnk-1"}

    assert db.query(models.ImportRow).count() == 1
    assert db.query(models.ImportLinkRow).count() == 1


def test_upload_tolerates_duplicate_uuid_inside_one_packet(client, headers, db):
    """Телефон мог склеить две очереди и прислать один ключ дважды в одном
    пакете. Это тот же повтор — выгрузка не должна падать целиком."""
    response = client.post(
        "/sync/upload",
        json={
            "devices": [
                {"client_uuid": "dev-1", "name": "Первый"},
                {"client_uuid": "dev-1", "name": "Он же"},
            ],
            "links": [],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 200
    assert response.json()["devices_added"] == 1
    assert db.query(models.ImportRow).count() == 1


def test_upload_drops_device_id_from_another_site(client, headers, db, site):
    """Телефон мог принести номер устройства из чужого снимка. Запись
    обхода от этого не пропадает — просто устройство придётся выбрать
    руками при переносе."""
    other = models.Site(name="Другая площадка")
    db.add(other)
    db.commit()
    db.refresh(other)

    response = client.post(
        "/sync/upload",
        json={
            "devices": [],
            "links": [{
                "client_uuid": "lnk-1", "a_device_text": "Свитч",
                # заведомо несуществующее устройство
                "a_device_id": 987654,
            }],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 200
    row = db.query(models.ImportLinkRow).one()
    assert row.a_device_id is None
    assert row.a_device_text == "Свитч"


def test_empty_upload_is_not_an_error(client, headers):
    """Сходил и ничего не нашёл — тоже результат."""
    response = client.post(
        "/sync/upload", json={"devices": [], "links": []}, headers=headers["editor"],
    )
    assert response.status_code == 200
    assert response.json()["devices_added"] == 0


def test_snapshot_carries_reference_data(client, headers, db, device_type):
    """Справочники нужны затем, что оффлайн подставлять их неоткуда:
    человек в цеху выбирает из списка, а не печатает по памяти."""
    response = client.get("/sync/snapshot", headers=headers["editor"])
    assert response.status_code == 200
    names = [t["name"] for t in response.json()["device_types"]]
    assert "Коммутатор" in names


def test_snapshot_carries_devices_with_ports_and_links(client, headers, make_device):
    """Снимок с настоящими данными, а не с пустой площадкой.

    Пустого снимка мало: устройства и связи собираются не прямо из записи, а
    сериализаторами — у них есть вычисляемые поля вроде «к чему подключён
    порт». На пустой площадке это не проверялось, и ручка падала ровно там,
    где тест её не трогал.
    """
    a = make_device(name="Свитч у окна")
    b = make_device(name="Камера над воротами")
    client.post("/links", json={
        "interface_a_id": a["interfaces"][0]["id"],
        "interface_b_id": b["interfaces"][0]["id"],
    }, headers=headers["editor"])

    body = client.get("/sync/snapshot", headers=headers["editor"]).json()
    assert len(body["devices"]) == 2
    # Порты внутри устройства — по ним человек в цеху и выбирает гнездо.
    first = next(d for d in body["devices"] if d["id"] == a["id"])
    assert len(first["interfaces"]) == 2
    # Связь с обоими концами — иначе на телефоне не показать, что куда воткнуто.
    assert len(body["links"]) == 1
    assert body["links"][0]["end_a"] is not None
    assert body["links"][0]["end_b"] is not None
    assert len(body["templates"]) >= 1
