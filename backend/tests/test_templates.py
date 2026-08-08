def test_create_template_with_ports(client, headers, device_type):
    response = client.post(
        "/device-templates",
        json={
            "name": "Cisco Catalyst 2960-24TT",
            "device_type_id": device_type.id,
            "manufacturer": "Cisco",
            "interfaces": [{"port_number": 1, "label": "Gi0/1"}, {"port_number": 2, "label": "Gi0/2"}],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 201
    assert len(response.json()["interfaces"]) == 2


def test_duplicate_port_numbers_in_one_template_are_rejected(client, headers, device_type):
    """Уникален номер, а не название: порт опознают по номеру на корпусе."""
    response = client.post(
        "/device-templates",
        json={
            "name": "Кривой шаблон",
            "device_type_id": device_type.id,
            "interfaces": [{"port_number": 1, "label": "Gi0/1"}, {"port_number": 1, "label": "Gi0/2"}],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 400


def test_same_label_on_different_numbers_is_allowed(client, headers, device_type):
    """Название — просто подпись, совпадать ей не запрещено."""
    response = client.post(
        "/device-templates",
        json={
            "name": "Две одинаково подписанные пары",
            "device_type_id": device_type.id,
            "interfaces": [{"port_number": 1, "label": "eth"}, {"port_number": 2, "label": "eth"}],
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
    added = client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"port_number": 3, "label": "SFP1"},
        headers=headers["editor"],
    )
    assert added.status_code == 201

    duplicate = client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"port_number": 3, "label": "SFP2"},
        headers=headers["editor"],
    )
    assert duplicate.status_code == 409, "номер занят — название тут ни при чём"

    removed = client.delete(
        f"/device-templates/{template.id}/interfaces/{added.json()['id']}", headers=headers["editor"]
    )
    assert removed.status_code == 204


def test_port_added_to_template_appears_on_existing_devices(client, headers, template, make_device):
    """Состав портов задаётся моделью: доукомплектовали модель — порт
    появился у всех её экземпляров, а не только у будущих."""
    first, second = make_device(), make_device()
    client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"port_number": 3, "label": "SFP1"},
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
