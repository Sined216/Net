"""Оптимистичная блокировка: кто сохранил вторым, тот узнаёт об этом.

Двое открыли одну железку, первый поправил расположение, второй — заметку.
Второй сохранял снимком своей формы и молча затирал правку первого: в
журнале обе, в базе только последняя. Теперь второму отвечают 409.
"""


def test_device_version_grows_with_each_edit(client, headers, make_device):
    device = make_device()
    assert device["version"] == 1

    first = client.patch(f"/devices/{device['id']}", json={"notes": "первая правка"},
                         headers=headers["editor"]).json()
    assert first["version"] == 2
    second = client.patch(f"/devices/{device['id']}", json={"notes": "вторая"},
                          headers=headers["editor"]).json()
    assert second["version"] == 3


def test_stale_device_edit_is_rejected(client, headers, make_device):
    """Второй сохраняет то, что видел до правки первого, — и получает отказ."""
    device = make_device()
    seen = device["version"]

    client.patch(f"/devices/{device['id']}", json={"version": seen, "name": "Станок 1"},
                 headers=headers["editor"])

    late = client.patch(
        f"/devices/{device['id']}",
        json={"version": seen, "notes": "правка второго"},
        headers=headers["editor"],
    )
    assert late.status_code == 409
    assert "другим пользователем" in late.json()["detail"]

    # Правка первого на месте, а не затёрта.
    current = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert current["name"] == "Станок 1"
    assert current["notes"] is None


def test_edit_with_fresh_version_passes(client, headers, make_device):
    """Обновил страницу — сохраняется как обычно."""
    device = make_device()
    first = client.patch(f"/devices/{device['id']}", json={"version": device["version"], "name": "Станок 1"},
                         headers=headers["editor"]).json()
    second = client.patch(f"/devices/{device['id']}", json={"version": first["version"], "notes": "и заметка"},
                          headers=headers["editor"])
    assert second.status_code == 200
    assert second.json()["notes"] == "и заметка"


def test_request_without_version_is_not_checked(client, headers, make_device):
    """Старый клиент и служебные вызовы работают как раньше: без номера
    проверять нечего."""
    device = make_device()
    client.patch(f"/devices/{device['id']}", json={"name": "Станок 1"}, headers=headers["editor"])
    late = client.patch(f"/devices/{device['id']}", json={"notes": "без номера"}, headers=headers["editor"])
    assert late.status_code == 200


def test_moving_a_node_does_not_break_someone_else_editing(client, headers, make_device):
    """Перетаскивание узла по схеме — не правка карточки.

    Иначе достаточно кому-то двигать схему, чтобы у соседа перестало
    сохраняться открытое окно устройства.
    """
    device = make_device()
    client.patch(f"/devices/{device['id']}/position", json={"x": 100, "y": 200},
                 headers=headers["editor"])

    saved = client.patch(f"/devices/{device['id']}", json={"version": device["version"], "notes": "заметка"},
                         headers=headers["editor"])
    assert saved.status_code == 200


def test_tags_are_covered_by_the_same_check(client, headers, make_device):
    device = make_device()
    seen = device["version"]
    client.patch(f"/devices/{device['id']}", json={"version": seen, "notes": "правка первого"},
                 headers=headers["editor"])

    late = client.put(f"/devices/{device['id']}/tags", json={"version": seen, "tag_ids": []},
                      headers=headers["editor"])
    assert late.status_code == 409


def test_interface_edit_is_checked(client, headers, make_device):
    device = make_device()
    port = device["interfaces"][0]
    assert port["version"] == 1

    first = client.patch(f"/interfaces/{port['id']}", json={"version": 1, "notes": "первый"},
                         headers=headers["editor"]).json()
    assert first["version"] == 2

    late = client.patch(f"/interfaces/{port['id']}", json={"version": 1, "notes": "второй"},
                        headers=headers["editor"])
    assert late.status_code == 409
    assert client.get(f"/devices/{device['id']}/interfaces",
                      headers=headers["viewer"]).json()[0]["notes"] == "первый"


def test_link_edit_is_checked(client, headers, make_device):
    a, b = make_device(), make_device()
    link = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()
    assert link["version"] == 1

    client.patch(f"/links/{link['id']}", json={"version": 1, "length_m": 12.5}, headers=headers["editor"])
    late = client.patch(f"/links/{link['id']}", json={"version": 1, "notes": "второй"},
                        headers=headers["editor"])
    assert late.status_code == 409


def test_moving_a_cable_end_bumps_the_link(client, headers, make_device):
    """Перестановка конца — правка связи: у того, кто держал её открытой,
    сохранение должно отбиться."""
    a, b = make_device(), make_device()
    link = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()

    moved = client.post(
        f"/links/{link['id']}/reconnect",
        json={"from_interface_id": a["interfaces"][0]["id"], "to_interface_id": a["interfaces"][1]["id"]},
        headers=headers["editor"],
    ).json()
    assert moved["version"] == link["version"] + 1

    late = client.patch(f"/links/{link['id']}", json={"version": link["version"], "notes": "поздно"},
                        headers=headers["editor"])
    assert late.status_code == 409
