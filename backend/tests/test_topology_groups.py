"""Вложенные группы на топологии: цех — участок — линия — шкаф и глубже,
до шести уровней."""


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
    """Шесть уровней — цех, участок, линия, шкаф и глубже — умещаются, а
    седьмой уже нет: рамка внутри рамки внутри рамки на этой глубине
    нечитаема на глаз."""
    parent_id = None
    for depth in range(1, 7):
        group = create(client, headers, f"Уровень {depth}", parent_id).json()
        parent_id = group["id"]
    assert create(client, headers, "Уровень 7", parent_id).status_code == 400


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


def test_group_box_is_saved(client, headers):
    """Рамку двигают и растягивают руками — положение и размер хранятся."""
    group = create(client, headers, "Цех 6").json()
    assert group["x"] is None, "у новой группы рамки ещё нет"

    saved = client.patch(
        f"/topology-groups/{group['id']}/box",
        json={"x": 120.5, "y": -40.0, "width": 480.0, "height": 300.0},
        headers=headers["editor"],
    )
    assert saved.status_code == 200
    assert (saved.json()["x"], saved.json()["width"]) == (120.5, 480.0)

    listed = next(g for g in client.get("/topology-groups", headers=headers["viewer"]).json() if g["id"] == group["id"])
    assert listed["height"] == 300.0


def test_group_box_rejects_zero_size(client, headers):
    """Нулевая рамка не рисуется и ничего не значит — такую не принимаем."""
    group = create(client, headers, "Цех 7").json()
    response = client.patch(
        f"/topology-groups/{group['id']}/box",
        json={"x": 0, "y": 0, "width": 0, "height": 100},
        headers=headers["editor"],
    )
    assert response.status_code == 422


def test_group_defaults_to_area(client, headers):
    group = create(client, headers, "Цех 8").json()
    assert group["kind"] == "area"


def test_cabinet_cannot_get_a_subgroup(client, headers):
    """Шкаф — конец дерева: внутрь него кладут только устройства."""
    cabinet = client.post(
        "/topology-groups", json={"name": "Шкаф 1", "kind": "cabinet"}, headers=headers["editor"],
    ).json()
    response = create(client, headers, "Подгруппа шкафа", cabinet["id"])
    assert response.status_code == 400


def test_group_with_children_cannot_become_cabinet(client, headers):
    shop = create(client, headers, "Цех 9").json()
    create(client, headers, "Линия C", shop["id"])
    response = client.patch(
        f"/topology-groups/{shop['id']}", json={"kind": "cabinet"}, headers=headers["editor"],
    )
    assert response.status_code == 400


def test_leaf_group_can_become_cabinet(client, headers):
    """Без подгрупп смена вида ничем не мешает."""
    leaf = create(client, headers, "Линия D").json()
    response = client.patch(
        f"/topology-groups/{leaf['id']}", json={"kind": "cabinet"}, headers=headers["editor"],
    )
    assert response.status_code == 200
    assert response.json()["kind"] == "cabinet"
