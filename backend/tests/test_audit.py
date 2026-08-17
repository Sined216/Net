"""Журнал изменений: кто, что и когда менял.

Раньше он только писался. Проверяем, что теперь его можно прочитать, что в
нём видно разницу «было — стало», что он не обходит изоляцию площадок и что
записи появляются не только по устройствам, но и по справочникам.
"""

import pytest

from app import models


def entries(client, headers, **params):
    response = client.get("/audit", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_device_history_shows_what_changed(client, headers, make_device):
    """Ради этого журнал и читают: что именно поправили в записи."""
    device = make_device(name="Станок 1")
    client.patch(f"/devices/{device['id']}", json={"name": "Станок 2"}, headers=headers["editor"])

    page = entries(client, headers["viewer"], entity_type="device", entity_id=device["id"])
    assert page["total"] == 2, "заведение и правка"

    update = page["items"][0]
    assert update["action"] == "update"
    assert update["entity_label"] == "Устройство"
    assert update["user_name"] == "Editor"
    # Изменилось только название — остальные поля в разнице не мешаются.
    assert [(c["label"], c["old"], c["new"]) for c in update["changes"]] == [
        ("название", "Станок 1", "Станок 2"),
    ]


def test_viewer_reads_the_log(client, headers, make_device):
    """Доступен всем ролям: «кто переставил станок» спрашивает как раз тот,
    кто сам править не может."""
    make_device(name="Станок")
    assert client.get("/audit", headers=headers["viewer"]).status_code == 200


def test_reference_books_are_logged_too(client, headers):
    """Раньше правка справочников не оставляла следов вовсе."""
    tag = client.post("/tags", json={"name": "Цех 1"}, headers=headers["editor"]).json()
    client.patch(f"/tags/{tag['id']}", json={"name": "Цех 2"}, headers=headers["editor"])
    client.delete(f"/tags/{tag['id']}", headers=headers["editor"])

    vlan = client.post("/vlans", json={"vlan_number": 10}, headers=headers["editor"]).json()
    client.post("/link-templates", json={"name": "Медь", "media_type": "copper"}, headers=headers["editor"])
    client.post("/device-types", json={"name": "Точка Wi-Fi 2", "code_prefix": "APX"}, headers=headers["editor"])

    kinds = {e["entity_type"] for e in entries(client, headers["viewer"])["items"]}
    assert {"tag", "vlan", "link_template", "device_type"} <= kinds
    assert vlan["id"]

    tag_log = entries(client, headers["viewer"], entity_type="tag")["items"]
    assert [e["action"] for e in tag_log] == ["delete", "update", "create"]


def test_filters_and_paging(client, headers, make_device):
    for n in range(5):
        make_device(name=f"Станок {n}")

    page = entries(client, headers["viewer"], entity_type="device", limit=2)
    assert page["total"] == 5
    assert len(page["items"]) == 2

    second = entries(client, headers["viewer"], entity_type="device", limit=2, offset=2)
    assert second["items"][0]["id"] != page["items"][0]["id"]

    # По человеку: правки редактора отделяются от чужих.
    only_editor = entries(client, headers["viewer"], user_id=2)
    assert all(e["user_id"] == 2 for e in only_editor["items"])


def test_log_does_not_leak_between_sites(client, headers, db, template, make_device):
    """Журнал не должен обходить изоляцию: чужие устройства не видно и в нём."""
    make_device(name="Своё устройство")

    other = models.Site(name="Чужая фабрика")
    db.add(other)
    db.commit()
    db.refresh(other)
    theirs = client.post(
        "/devices", json={"template_id": template.id, "name": "Чужое устройство"},
        headers={**headers["admin"], "X-Site-Id": str(other.id)},
    )
    assert theirs.status_code == 201, theirs.text

    names = [
        change["new"]
        for entry in entries(client, headers["editor"])["items"]
        for change in entry["changes"] if change["field"] == "name"
    ]
    assert "Своё устройство" in names
    assert "Чужое устройство" not in names


def test_shared_reference_changes_are_visible_everywhere(client, headers, db):
    """А правка общего справочника видна на любой площадке: он общий."""
    client.post("/link-templates", json={"name": "Оптика", "media_type": "fiber"},
                headers=headers["editor"])
    other = models.Site(name="Ещё фабрика")
    db.add(other)
    db.commit()
    db.refresh(other)

    seen = entries(client, {**headers["admin"], "X-Site-Id": str(other.id)}, entity_type="link_template")
    assert seen["total"] == 1


def test_position_dragging_is_not_logged(client, headers, make_device):
    """Перетаскивание узла по схеме — оформление, а не изменение данных.
    Иначе журнал забивается мусором и в нём не найти настоящих правок."""
    device = make_device()
    before = entries(client, headers["viewer"])["total"]
    client.patch(f"/devices/{device['id']}/position", json={"x": 10, "y": 20}, headers=headers["editor"])
    assert entries(client, headers["viewer"])["total"] == before


def test_empty_update_is_not_logged(client, headers, make_device):
    """Сохранение без изменений — не событие.

    Форма устройства шлёт и свойства, и теги; обычно один из запросов ничего
    не меняет, и запись «правка» без единого изменённого поля только сбивает
    с толку.
    """
    device = make_device(name="Станок")
    before = entries(client, headers["viewer"])["total"]
    client.patch(f"/devices/{device['id']}", json={"name": "Станок"}, headers=headers["editor"])
    client.put(f"/devices/{device['id']}/tags", json={"tag_ids": []}, headers=headers["editor"])
    assert entries(client, headers["viewer"])["total"] == before


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 500}, {"offset": -1}])
def test_bad_paging_is_refused(client, headers, params):
    assert client.get("/audit", params=params, headers=headers["viewer"]).status_code == 422
