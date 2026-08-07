def test_create_template_with_ports(client, headers, device_type):
    response = client.post(
        "/device-templates",
        json={
            "name": "Cisco Catalyst 2960-24TT",
            "device_type_id": device_type.id,
            "manufacturer": "Cisco",
            "interfaces": [{"label": "Gi0/1", "port_number": 1}, {"label": "Gi0/2", "port_number": 2}],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 201
    assert len(response.json()["interfaces"]) == 2


def test_duplicate_port_labels_in_one_template_are_rejected(client, headers, device_type):
    response = client.post(
        "/device-templates",
        json={
            "name": "Кривой шаблон",
            "device_type_id": device_type.id,
            "interfaces": [{"label": "Gi0/1"}, {"label": "Gi0/1"}],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 400


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
        json={"label": "SFP1", "port_number": 3},
        headers=headers["editor"],
    )
    assert added.status_code == 201

    duplicate = client.post(
        f"/device-templates/{template.id}/interfaces", json={"label": "SFP1"}, headers=headers["editor"]
    )
    assert duplicate.status_code == 409

    removed = client.delete(
        f"/device-templates/{template.id}/interfaces/{added.json()['id']}", headers=headers["editor"]
    )
    assert removed.status_code == 204


def test_ports_added_to_template_do_not_touch_existing_devices(client, headers, template, make_device):
    """Порты копируются в устройство один раз, при создании: шаблон — это
    описание модели, а не живая связь с уже заведёнными экземплярами."""
    device = make_device()
    client.post(
        f"/device-templates/{template.id}/interfaces", json={"label": "SFP1"}, headers=headers["editor"]
    )

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert len(refreshed["interfaces"]) == 2


def test_device_type_in_use_cannot_be_deleted(client, headers, device_type, template):
    response = client.delete(f"/device-types/{device_type.id}", headers=headers["editor"])
    assert response.status_code == 409
