def test_create_template_with_ports(client, headers, device_type):
    response = client.post(
        "/device-templates",
        json={
            "name": "Cisco Catalyst 2960-24TT",
            "device_type_id": device_type.id,
            "manufacturer": "Cisco",
            "interfaces": [{"label": "Gi0/1"}, {"label": "Gi0/2"}],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 201
    interfaces = response.json()["interfaces"]
    assert len(interfaces) == 2
    # Номер — место в ряду гнёзд, его раздаёт сервер по порядку списка.
    assert sorted(i["port_number"] for i in interfaces) == [1, 2]


def test_same_label_on_different_ports_is_allowed(client, headers, device_type):
    """Название — просто подпись, совпадать ей не запрещено."""
    response = client.post(
        "/device-templates",
        json={
            "name": "Две одинаково подписанные пары",
            "device_type_id": device_type.id,
            "interfaces": [{"label": "eth"}, {"label": "eth"}],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 201


def test_unknown_device_type_is_rejected(client, headers):
    response = client.post(
        "/device-templates",
        json={"name": "Шаблон", "device_type_id": 9999, "interfaces": []},
        headers=headers["editor"],
    )
    assert response.status_code == 404


def test_template_in_use_cannot_be_deleted(client, headers, template, make_device):
    make_device()
    response = client.delete(f"/device-templates/{template.id}", headers=headers["editor"])
    assert response.status_code == 409


def test_unused_template_can_be_deleted(client, headers, template):
    assert client.delete(f"/device-templates/{template.id}", headers=headers["editor"]).status_code == 204


def test_template_port_added_and_removed(client, headers, template):
    """Новый порт встаёт в конец ряда — номер ему даёт сервер."""
    added = client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"label": "SFP1"},
        headers=headers["editor"],
    )
    assert added.status_code == 201
    assert added.json()["port_number"] == 3, "в шаблоне уже два порта"

    another = client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"label": "SFP2"},
        headers=headers["editor"],
    )
    assert another.json()["port_number"] == 4

    removed = client.delete(
        f"/device-templates/{template.id}/interfaces/{added.json()['id']}", headers=headers["editor"]
    )
    assert removed.status_code == 204


def test_port_numbers_stay_contiguous_after_removal(client, headers, template, make_device):
    """Ряд гнёзд сплошной: убрали порт из середины — остальные сдвинулись.

    Пропущенный номер означал бы гнездо, которого у железки нет."""
    device = make_device()
    tpl = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()
    first = sorted(tpl["interfaces"], key=lambda i: i["port_number"])[0]

    client.delete(f"/device-templates/{template.id}/interfaces/{first['id']}", headers=headers["editor"])

    tpl = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()
    assert [i["port_number"] for i in sorted(tpl["interfaces"], key=lambda i: i["port_number"])] == [1]
    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert [i["port_number"] for i in refreshed["interfaces"]] == [1]
    # Устройство и модель по-прежнему сходятся: номер один и тот же порт.
    assert [i["label"] for i in refreshed["interfaces"]] == [tpl["interfaces"][0]["label"]]


def test_port_added_to_template_appears_on_existing_devices(client, headers, template, make_device):
    """Состав портов задаётся моделью: доукомплектовали модель — порт
    появился у всех её экземпляров, а не только у будущих."""
    first, second = make_device(), make_device()
    client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"label": "SFP1"},
        headers=headers["editor"],
    )

    for device in (first, second):
        refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
        assert [i["label"] for i in refreshed["interfaces"]] == ["Порт 1", "Порт 2", "SFP1"]


def test_port_removed_from_template_disappears_from_devices(client, headers, template, make_device):
    device = make_device()
    tpl = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()
    port_id = tpl["interfaces"][0]["id"]

    client.delete(f"/device-templates/{template.id}/interfaces/{port_id}", headers=headers["editor"])

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert [i["label"] for i in refreshed["interfaces"]] == ["Порт 2"]


def test_impact_reports_devices_and_connected_ports(client, headers, template, make_device):
    a, b = make_device(), make_device()
    client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    )

    impact = client.get(f"/device-templates/{template.id}/impact", headers=headers["viewer"]).json()
    assert impact == {"devices": 2, "connected_ports": 1}


def test_device_type_in_use_cannot_be_deleted(client, headers, device_type, template):
    response = client.delete(f"/device-types/{device_type.id}", headers=headers["editor"])
    assert response.status_code == 409


def test_template_port_lands_before_hand_made_ports(client, headers, template, make_device):
    """Порт модели встаёт сразу за портами модели, а не за самодельными.

    Иначе номер порта в модели и в устройстве разошёлся бы, и правка модели
    перестала бы попадать в нужное гнездо."""
    client.patch(
        f"/device-templates/{template.id}",
        json={"ports_editable_on_device": True},
        headers=headers["editor"],
    )
    device = make_device()
    client.post(f"/devices/{device['id']}/interfaces", json={"label": "Своя карта"},
                headers=headers["editor"])

    client.post(f"/device-templates/{template.id}/interfaces", json={"label": "SFP1"},
                headers=headers["editor"])

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert [(i["port_number"], i["label"]) for i in refreshed["interfaces"]] == [
        (1, "Порт 1"), (2, "Порт 2"), (3, "SFP1"), (4, "Своя карта"),
    ]


def test_bulk_ports_are_all_created(client, headers, template):
    """Двадцать четыре порта одним запросом.

    Раньше интерфейс слал их по одному и параллельно: все запросы читали
    один и тот же «следующий номер», и из восьми портов доезжали два."""
    before = len(client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()["interfaces"])

    response = client.post(
        f"/device-templates/{template.id}/interfaces/bulk", json={"count": 24}, headers=headers["editor"],
    )
    assert response.status_code == 201
    assert len(response.json()) == 24

    ports = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()["interfaces"]
    numbers = sorted(p["port_number"] for p in ports)
    assert numbers == list(range(1, before + 24 + 1)), "ряд номеров остаётся сплошным"


def test_bulk_ports_reach_devices(client, headers, template, make_device):
    device = make_device()
    client.post(f"/device-templates/{template.id}/interfaces/bulk", json={"count": 5}, headers=headers["editor"])

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert [i["port_number"] for i in refreshed["interfaces"]] == list(range(1, 8))


def test_template_edit_finds_the_right_port_after_a_card_was_removed(client, headers, device_type, db):
    """Правка порта модели должна попадать в тот же порт, а не в соседний.

    Сняли на ПК вторую карту — номера оставшихся портов сомкнулись. Раньше
    порт устройства искали по номеру, и правка порта №2 в модели
    переименовывала на этом ПК уже третий порт. Молча."""
    template = client.post(
        "/device-templates",
        json={
            "name": "ПК со съёмной картой", "device_type_id": device_type.id,
            "ports_editable_on_device": True,
            "interfaces": [{"label": "eth0"}, {"label": "eth1"}, {"label": "eth2"}],
        },
        headers=headers["editor"],
    ).json()
    device = client.post("/devices", json={"template_id": template["id"]}, headers=headers["editor"]).json()

    # сняли eth1 — остались eth0 (№1) и eth2 (№2)
    client.delete(f"/interfaces/{device['interfaces'][1]['id']}", headers=headers["editor"])
    ports = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"]
    assert [(p["port_number"], p["label"]) for p in ports] == [(1, "eth0"), (2, "eth2")]

    # правим в модели eth1 — на устройстве его больше нет, задеть ничего не должно
    eth1 = [p for p in template["interfaces"] if p["label"] == "eth1"][0]
    client.patch(
        f"/device-templates/{template['id']}/interfaces/{eth1['id']}",
        json={"label": "eth1 (новая карта)"}, headers=headers["editor"],
    )

    ports = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"]
    assert [p["label"] for p in ports] == ["eth0", "eth2"], "переименован соседний порт"


def test_template_port_removal_takes_its_own_copies(client, headers, device_type):
    """Удаление порта модели забирает именно свои копии у устройств."""
    template = client.post(
        "/device-templates",
        json={
            "name": "ПК со съёмной картой 2", "device_type_id": device_type.id,
            "ports_editable_on_device": True,
            "interfaces": [{"label": "eth0"}, {"label": "eth1"}, {"label": "eth2"}],
        },
        headers=headers["editor"],
    ).json()
    device = client.post("/devices", json={"template_id": template["id"]}, headers=headers["editor"]).json()
    client.delete(f"/interfaces/{device['interfaces'][0]['id']}", headers=headers["editor"])  # сняли eth0

    eth2 = [p for p in template["interfaces"] if p["label"] == "eth2"][0]
    client.delete(f"/device-templates/{template['id']}/interfaces/{eth2['id']}", headers=headers["editor"])

    ports = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"]
    assert [p["label"] for p in ports] == ["eth1"]
