"""Правка VLAN.

Создание и удаление уже были — здесь только PATCH и то, что не показывалось
в интерфейсе (DHCP-диапазон, заметки), но действительно уходило в базу.
"""


def test_vlan_can_be_edited(client, headers):
    vlan = client.post(
        "/vlans", json={"vlan_number": 10, "name": "Опечатка"}, headers=headers["editor"]
    ).json()

    response = client.patch(
        f"/vlans/{vlan['id']}",
        json={"name": "Цех 1", "dhcp_range": "10.10.1.100-10.10.1.200", "notes": "заметка"},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Цех 1"
    assert body["dhcp_range"] == "10.10.1.100-10.10.1.200"
    assert body["notes"] == "заметка"
    # Номер не передавался — остался прежним.
    assert body["vlan_number"] == 10


def test_vlan_dhcp_range_and_notes_are_stored_and_returned(client, headers):
    """Раньше эти поля принимала только форма создания, а показать их было
    негде — правились они и оставались невидимыми, но не бесследными."""
    vlan = client.post(
        "/vlans",
        json={"vlan_number": 20, "dhcp_range": "10.10.2.10-10.10.2.250", "notes": "старый шлюз выведен"},
        headers=headers["editor"],
    ).json()
    assert vlan["dhcp_range"] == "10.10.2.10-10.10.2.250"
    assert vlan["notes"] == "старый шлюз выведен"

    fetched = client.get("/vlans", headers=headers["viewer"]).json()
    same = next(v for v in fetched if v["id"] == vlan["id"])
    assert same["dhcp_range"] == "10.10.2.10-10.10.2.250"
    assert same["notes"] == "старый шлюз выведен"


def test_vlan_number_can_be_changed_to_a_free_one(client, headers):
    vlan = client.post("/vlans", json={"vlan_number": 30}, headers=headers["editor"]).json()
    response = client.patch(f"/vlans/{vlan['id']}", json={"vlan_number": 31}, headers=headers["editor"])
    assert response.status_code == 200
    assert response.json()["vlan_number"] == 31


def test_vlan_number_cannot_collide_with_another_vlan(client, headers):
    client.post("/vlans", json={"vlan_number": 40}, headers=headers["editor"])
    second = client.post("/vlans", json={"vlan_number": 41}, headers=headers["editor"]).json()

    response = client.patch(f"/vlans/{second['id']}", json={"vlan_number": 40}, headers=headers["editor"])
    assert response.status_code == 409

    # Своё же прежнее значение — не коллизия сама с собой.
    same = client.patch(f"/vlans/{second['id']}", json={"vlan_number": 41}, headers=headers["editor"])
    assert same.status_code == 200


def test_unknown_vlan_patch_is_404(client, headers):
    response = client.patch("/vlans/9999", json={"name": "неважно"}, headers=headers["editor"])
    assert response.status_code == 404


def test_viewer_cannot_edit_vlan(client, headers):
    vlan = client.post("/vlans", json={"vlan_number": 50}, headers=headers["editor"]).json()
    response = client.patch(f"/vlans/{vlan['id']}", json={"name": "чужое"}, headers=headers["viewer"])
    assert response.status_code == 403
