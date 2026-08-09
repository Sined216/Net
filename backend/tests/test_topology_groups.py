"""Вложенные группы на топологии: цех — участок — линия."""


def create(client, headers, name, parent_id=None):
    return client.post(
        "/topology-groups",
        json={"name": name, "color": "#94a3b8", **({"parent_id": parent_id} if parent_id else {})},
        headers=headers["editor"],
    )


def test_group_can_be_nested(client, headers):
    shop = create(client, headers, "Цех 1").json()
    line = create(client, headers, "Линия A", shop["id"])
    assert line.status_code == 201
    assert line.json()["parent_id"] == shop["id"]


def test_group_cannot_contain_itself(client, headers):
    shop = create(client, headers, "Цех 2").json()
    response = client.patch(
        f"/topology-groups/{shop['id']}", json={"parent_id": shop["id"]}, headers=headers["editor"]
    )
    assert response.status_code == 400


def test_group_cannot_be_nested_into_own_child(client, headers):
    """Иначе ветка отрывается от дерева и пропадает со схемы целиком."""
    shop = create(client, headers, "Цех 3").json()
    line = create(client, headers, "Линия B", shop["id"]).json()
    response = client.patch(
        f"/topology-groups/{shop['id']}", json={"parent_id": line["id"]}, headers=headers["editor"]
    )
    assert response.status_code == 400


def test_nesting_is_limited_in_depth(client, headers):
    shop = create(client, headers, "Цех 4").json()
    area = create(client, headers, "Участок 1", shop["id"]).json()
    line = create(client, headers, "Линия C", area["id"]).json()
    assert create(client, headers, "Станок", line["id"]).status_code == 400


def test_deleted_group_releases_children_and_devices(client, headers, make_device):
    """Удалили цех — участки всплывают наверх, устройства остаются на схеме."""
    shop = create(client, headers, "Цех 5").json()
    area = create(client, headers, "Участок 2", shop["id"]).json()
    device = make_device()
    client.patch(f"/devices/{device['id']}", json={"topology_group_id": shop["id"]}, headers=headers["editor"])

    assert client.delete(f"/topology-groups/{shop['id']}", headers=headers["editor"]).status_code == 204

    groups = client.get("/topology-groups", headers=headers["viewer"]).json()
    assert [g["parent_id"] for g in groups if g["id"] == area["id"]] == [None]
    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert refreshed["topology_group_id"] is None
