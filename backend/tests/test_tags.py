def test_nested_tags(client, headers):
    parent = client.post("/tags", json={"name": "Завод"}, headers=headers["editor"]).json()
    child = client.post(
        "/tags", json={"name": "Цех 1", "parent_id": parent["id"]}, headers=headers["editor"]
    ).json()
    assert child["parent_id"] == parent["id"]


def test_same_name_allowed_under_different_parents(client, headers):
    first = client.post("/tags", json={"name": "Завод 1"}, headers=headers["editor"]).json()
    second = client.post("/tags", json={"name": "Завод 2"}, headers=headers["editor"]).json()

    client.post("/tags", json={"name": "Шкаф А", "parent_id": first["id"]}, headers=headers["editor"])
    response = client.post(
        "/tags", json={"name": "Шкаф А", "parent_id": second["id"]}, headers=headers["editor"]
    )
    assert response.status_code == 201, "одноимённые теги у разных родителей — как папки в разных каталогах"


def test_duplicate_name_under_same_parent_is_rejected(client, headers):
    client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"])
    response = client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"])
    assert response.status_code == 409


def test_tag_cannot_become_its_own_parent(client, headers):
    tag = client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"]).json()
    response = client.patch(f"/tags/{tag['id']}", json={"parent_id": tag["id"]}, headers=headers["editor"])
    assert response.status_code == 400


def test_tag_cannot_become_child_of_its_own_descendant(client, headers):
    grandparent = client.post("/tags", json={"name": "Завод"}, headers=headers["editor"]).json()
    parent = client.post(
        "/tags", json={"name": "Цех 1", "parent_id": grandparent["id"]}, headers=headers["editor"]
    ).json()
    child = client.post(
        "/tags", json={"name": "Шкаф А", "parent_id": parent["id"]}, headers=headers["editor"]
    ).json()

    response = client.patch(
        f"/tags/{grandparent['id']}", json={"parent_id": child["id"]}, headers=headers["editor"]
    )
    assert response.status_code == 400


def test_deleting_parent_cascades_to_children(client, headers):
    parent = client.post("/tags", json={"name": "Завод"}, headers=headers["editor"]).json()
    client.post("/tags", json={"name": "Цех 1", "parent_id": parent["id"]}, headers=headers["editor"])

    assert client.delete(f"/tags/{parent['id']}", headers=headers["editor"]).status_code == 204
    assert client.get("/tags", headers=headers["viewer"]).json() == []


def test_deleting_tag_leaves_device_intact(client, headers, make_device):
    tag = client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"]).json()
    device = make_device(tag_ids=[tag["id"]])

    client.delete(f"/tags/{tag['id']}", headers=headers["editor"])

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"])
    assert refreshed.status_code == 200
    assert refreshed.json()["tags"] == []


def test_viewer_cannot_create_tag(client, headers):
    assert client.post("/tags", json={"name": "Цех 1"}, headers=headers["viewer"]).status_code == 403
