def test_device_gets_generated_code_and_template_ports(client, headers, template):
    response = client.post("/devices", json={"template_id": template.id}, headers=headers["editor"])
    assert response.status_code == 201

    device = response.json()
    assert device["code"] == "SW-0001"
    assert [i["label"] for i in device["interfaces"]] == ["Порт 1", "Порт 2"]
    assert all(i["connected_to"] is None for i in device["interfaces"])


def test_codes_increment_per_prefix(client, headers, template, db):
    from app import models

    codes = [
        client.post("/devices", json={"template_id": template.id}, headers=headers["editor"]).json()["code"]
        for _ in range(3)
    ]
    assert codes == ["SW-0001", "SW-0002", "SW-0003"]

    # Другой тип устройства считает свою нумерацию с единицы, независимо.
    other_type = models.DeviceType(name="Сервер", code_prefix="SRV")
    db.add(other_type)
    db.flush()
    other_template = models.DeviceTemplate(name="Тестовый сервер", device_type_id=other_type.id)
    db.add(other_template)
    db.commit()
    db.refresh(other_template)

    response = client.post("/devices", json={"template_id": other_template.id}, headers=headers["editor"])
    assert response.json()["code"] == "SRV-0001"


def test_code_sequence_catches_up_with_existing_devices(client, headers, template, db, site):
    """Счётчик кодов сверяется с фактическими кодами при старте.

    Так бывает после восстановления из дампа, снятого без `code_sequences`,
    или после заливки устройств прямым SQL: счётчик отстал, и следующее
    заведённое устройство упиралось в занятый код — заводить их было нельзя
    вовсе, пока кто-нибудь не поправит счётчик руками.
    """
    from app import codegen, models

    # Устройство мимо приложения — со своим кодом далеко впереди счётчика.
    db.add(models.Device(site_id=site.id, template_id=template.id, code="SW-0042"))
    db.commit()
    assert db.query(models.CodeSequence).filter_by(prefix="SW").first() is None

    codegen.sync_sequences(db)

    response = client.post("/devices", json={"template_id": template.id}, headers=headers["editor"])
    assert response.status_code == 201, response.text
    assert response.json()["code"] == "SW-0043", "код должен продолжать фактический ряд"


def test_unknown_template_is_rejected(client, headers):
    response = client.post("/devices", json={"template_id": 9999}, headers=headers["editor"])
    assert response.status_code == 404


def test_viewer_cannot_create_device(client, headers, template):
    response = client.post("/devices", json={"template_id": template.id}, headers=headers["viewer"])
    assert response.status_code == 403


def test_update_device(client, headers, make_device):
    device = make_device()
    response = client.patch(
        f"/devices/{device['id']}",
        json={"name": "Коммутатор цеха 1"},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Коммутатор цеха 1"
    assert response.json()["code"] == device["code"], "код устройства не должен меняться при правке"


def test_delete_device_removes_its_interfaces(client, headers, make_device, db):
    from app import models

    device = make_device()
    assert client.delete(f"/devices/{device['id']}", headers=headers["editor"]).status_code == 204
    assert db.query(models.Interface).filter(models.Interface.device_id == device["id"]).count() == 0


def test_tags_are_assigned_and_replaced(client, headers, make_device):
    first = client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"]).json()
    second = client.post("/tags", json={"name": "Критичное"}, headers=headers["editor"]).json()

    device = make_device(tag_ids=[first["id"]])
    assert [t["id"] for t in device["tags"]] == [first["id"]]

    response = client.put(
        f"/devices/{device['id']}/tags", json={"tag_ids": [second["id"]]}, headers=headers["editor"]
    )
    assert response.status_code == 200
    assert [t["id"] for t in response.json()["tags"]] == [second["id"]]


def test_unknown_tag_is_rejected(client, headers, template):
    response = client.post(
        "/devices", json={"template_id": template.id, "tag_ids": [9999]}, headers=headers["editor"]
    )
    assert response.status_code == 404


def test_filter_devices_by_tag(client, headers, make_device):
    tag = client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"]).json()
    tagged = make_device(tag_ids=[tag["id"]])
    make_device()

    response = client.get("/devices", params={"tag_id": tag["id"]}, headers=headers["viewer"])
    assert [d["id"] for d in response.json()["items"]] == [tagged["id"]]


def test_ports_cannot_be_added_to_device_by_default(client, headers, make_device):
    """Состав портов — свойство модели: иначе одинаковые коммутаторы
    разъезжаются по составу, и понять, где правда, невозможно."""
    device = make_device()
    response = client.post(
        f"/devices/{device['id']}/interfaces",
        json={"label": "SFP1"},
        headers=headers["editor"],
    )
    assert response.status_code == 409
    assert "шаблон" in response.json()["detail"].lower()


def test_ports_can_be_added_when_model_allows(client, headers, template, make_device):
    """У ПК сетевую карту действительно доставляют — для таких моделей
    состав портов открыт явным флагом."""
    client.patch(
        f"/device-templates/{template.id}",
        json={"ports_editable_on_device": True},
        headers=headers["editor"],
    )
    device = make_device()

    response = client.post(
        f"/devices/{device['id']}/interfaces",
        json={"label": "SFP1"},
        headers=headers["editor"],
    )
    assert response.status_code == 201
    assert response.json()["port_number"] == 3, "порт встаёт в конец ряда"

    another = client.post(
        f"/devices/{device['id']}/interfaces",
        json={"label": "SFP2"},
        headers=headers["editor"],
    )
    assert another.json()["port_number"] == 4

    # Убрали карту из середины — ряд снова сплошной.
    client.delete(f"/interfaces/{response.json()['id']}", headers=headers["editor"])
    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert [i["port_number"] for i in refreshed["interfaces"]] == [1, 2, 3]
    assert [i["label"] for i in refreshed["interfaces"]][-1] == "SFP2"


def test_position_is_saved(client, headers, make_device):
    device = make_device()
    response = client.patch(
        f"/devices/{device['id']}/position", json={"x": 120.5, "y": -40.0}, headers=headers["editor"]
    )
    assert response.status_code == 200
    assert (response.json()["topology_x"], response.json()["topology_y"]) == (120.5, -40.0)


def test_positions_are_saved_in_one_request(client, headers, make_device):
    """Автоматическая раскладка двигает всю схему сразу, и отдельный запрос на
    каждый узел здесь означал бы сотню запросов на одно нажатие кнопки."""
    one = make_device()
    two = make_device()
    response = client.patch(
        "/devices/positions",
        json={"positions": [
            {"id": one["id"], "x": 10.0, "y": 20.0},
            {"id": two["id"], "x": -30.5, "y": 40.5},
            # Устройства, которого уже нет: раскладка считалась по схеме, из
            # которой его успели удалить.
            {"id": 999_999, "x": 1.0, "y": 1.0},
        ]},
        headers=headers["editor"],
    )
    assert response.status_code == 204

    saved = {
        d["code"]: (d["topology_x"], d["topology_y"])
        for d in client.get("/devices", headers=headers["viewer"]).json()["items"]
    }
    assert saved[one["code"]] == (10.0, 20.0)
    assert saved[two["code"]] == (-30.5, 40.5)


def test_positions_need_edit_rights(client, headers, make_device):
    device = make_device()
    response = client.patch(
        "/devices/positions",
        json={"positions": [{"id": device["id"], "x": 1.0, "y": 2.0}]},
        headers=headers["viewer"],
    )
    assert response.status_code == 403


def test_search_treats_wildcards_as_text(client, headers, make_device, db):
    """% и _ — шаблоны ILIKE, а не символы. Запрос «%» возвращал вообще всё,
    хотя человек ищет текст, а не пишет шаблон."""
    from app import models

    device = make_device()
    iface = db.query(models.Interface).filter(models.Interface.device_id == device["id"]).first()
    iface.ip = "10.10.1.5"
    db.commit()

    assert client.get("/search", params={"query": "10.10"}, headers=headers["viewer"]).json(), "обычный поиск работает"
    assert client.get("/search", params={"query": "%"}, headers=headers["viewer"]).json() == []
    assert client.get("/search", params={"query": "10_10"}, headers=headers["viewer"]).json() == []


def test_search_finds_device_by_own_ip_and_mac(client, headers, make_device):
    """Раньше поиск смотрел только на IP/MAC порта — свои поля устройства
    (management_ip, mac) не участвовали вовсе."""
    device = make_device()
    client.patch(
        f"/devices/{device['id']}", json={"management_ip": "10.20.30.40", "mac": "A4-BB-6D-00-00-01"},
        headers=headers["editor"],
    )

    by_ip = client.get("/search", params={"query": "10.20.30.40"}, headers=headers["viewer"]).json()
    assert [r["device_id"] for r in by_ip] == [device["id"]]
    assert by_ip[0]["interface_id"] is None, "нашли устройство, а не какой-то из его портов"

    by_mac = client.get("/search", params={"query": "a4bb6d000001"}, headers=headers["viewer"]).json()
    assert [r["device_id"] for r in by_mac] == [device["id"]]


def test_search_finds_device_without_a_single_port(client, headers, db):
    """INNER JOIN на порт делал устройство без единого порта невидимым для
    поиска целиком — даже по собственному имени."""
    from app import models

    dt = models.DeviceType(name="ИБП", code_prefix="UPS")
    db.add(dt)
    db.flush()
    tpl = models.DeviceTemplate(name="ИБП без портов", device_type_id=dt.id)
    db.add(tpl)
    db.commit()
    db.refresh(tpl)

    response = client.post(
        "/devices", json={"template_id": tpl.id, "name": "Резервный ИБП"}, headers=headers["editor"]
    )
    assert response.status_code == 201
    device = response.json()
    assert device["interfaces"] == []

    found = client.get("/search", params={"query": "Резервный ИБП"}, headers=headers["viewer"]).json()
    assert [r["device_id"] for r in found] == [device["id"]]


def test_search_by_device_code_is_one_row_not_one_per_port(client, headers, make_device):
    """Совпадение по имени или коду устройства раньше фан-аутилось на
    строку на каждый его порт."""
    device = make_device()
    found = client.get("/search", params={"query": device["code"]}, headers=headers["viewer"]).json()
    assert [r["device_id"] for r in found] == [device["id"]]
