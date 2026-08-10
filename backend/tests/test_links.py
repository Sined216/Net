"""Связи — самая хрупкая часть модели: статус порта нигде не хранится, а
вычисляется по наличию записи в links, и каждый порт может участвовать не
более чем в одной связи."""

import pytest


@pytest.fixture
def two_devices(make_device):
    return make_device(), make_device()


def test_link_marks_both_ports_connected(client, headers, two_devices):
    a, b = two_devices
    port_a, port_b = a["interfaces"][0], b["interfaces"][0]

    response = client.post(
        "/links",
        json={"interface_a_id": port_a["id"], "interface_b_id": port_b["id"]},
        headers=headers["editor"],
    )
    assert response.status_code == 201

    refreshed = client.get(f"/devices/{a['id']}", headers=headers["viewer"]).json()
    connected = next(i for i in refreshed["interfaces"] if i["id"] == port_a["id"])
    assert connected["connected_to"]["device_code"] == b["code"]
    assert connected["connected_to"]["interface_label"] == port_b["label"]


def test_busy_port_cannot_be_linked_twice(client, headers, make_device):
    a, b, c = make_device(), make_device(), make_device()
    client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    )

    response = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": c["interfaces"][0]["id"]},
        headers=headers["editor"],
    )
    assert response.status_code == 409


def test_port_busy_as_b_side_cannot_be_reused_as_a_side(client, headers, make_device):
    """Порт, занятый как сторона B, не должен принимать новую связь как
    сторона A — уникальные индексы стоят на колонках по отдельности и сами
    по себе такого не ловят."""
    a, b, c = make_device(), make_device(), make_device()
    first = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()

    busy_port = first["interface_b_id"]
    response = client.post(
        "/links",
        json={"interface_a_id": busy_port, "interface_b_id": c["interfaces"][0]["id"]},
        headers=headers["editor"],
    )
    assert response.status_code == 409


def test_interface_cannot_be_linked_to_itself(client, headers, make_device):
    device = make_device()
    port = device["interfaces"][0]["id"]
    response = client.post(
        "/links", json={"interface_a_id": port, "interface_b_id": port}, headers=headers["editor"]
    )
    assert response.status_code == 400


def test_endpoints_are_stored_in_canonical_order(client, headers, two_devices):
    """A и B нормализуются по возрастанию id, чтобы одна и та же связь не
    задваивалась в зеркальном виде."""
    a, b = two_devices
    high, low = sorted((a["interfaces"][0]["id"], b["interfaces"][0]["id"]), reverse=True)

    link = client.post(
        "/links", json={"interface_a_id": high, "interface_b_id": low}, headers=headers["editor"]
    ).json()
    assert link["interface_a_id"] == low
    assert link["interface_b_id"] == high


def test_unknown_interface_is_rejected(client, headers, make_device):
    device = make_device()
    response = client.post(
        "/links",
        json={"interface_a_id": device["interfaces"][0]["id"], "interface_b_id": 9999},
        headers=headers["editor"],
    )
    assert response.status_code == 404


def test_deleting_link_frees_both_ports(client, headers, two_devices):
    a, b = two_devices
    link = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()

    assert client.delete(f"/links/{link['id']}", headers=headers["editor"]).status_code == 204

    refreshed = client.get(f"/devices/{a['id']}", headers=headers["viewer"]).json()
    assert all(i["connected_to"] is None for i in refreshed["interfaces"])


def test_deleting_device_removes_its_links(client, headers, two_devices):
    a, b = two_devices
    client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    )

    client.delete(f"/devices/{b['id']}", headers=headers["editor"])

    assert client.get("/links", headers=headers["viewer"]).json()["items"] == []
    refreshed = client.get(f"/devices/{a['id']}", headers=headers["viewer"]).json()
    assert all(i["connected_to"] is None for i in refreshed["interfaces"])


def test_link_template_can_be_assigned_and_survives_template_deletion(client, headers, two_devices):
    a, b = two_devices
    link = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()
    assert link["template_id"] is None

    link_template = client.post(
        "/link-templates",
        json={"name": "Медь Cat6", "media_type": "copper", "color": "#3366ff"},
        headers=headers["editor"],
    ).json()

    updated = client.patch(
        f"/links/{link['id']}",
        json={"template_id": link_template["id"], "connector_type": "RJ45", "length_m": 40},
        headers=headers["editor"],
    ).json()
    assert updated["template_id"] == link_template["id"]
    assert updated["length_m"] == 40

    # Удаление шаблона не должно удалять сами связи — у них просто пропадёт
    # оформление на топологии (ON DELETE SET NULL).
    client.delete(f"/link-templates/{link_template['id']}", headers=headers["editor"])
    survived = client.get("/links", headers=headers["viewer"]).json()["items"]
    assert len(survived) == 1
    assert survived[0]["template_id"] is None


def test_viewer_cannot_create_link(client, headers, two_devices):
    a, b = two_devices
    response = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["viewer"],
    )
    assert response.status_code == 403
