"""Разъёмы, модули и режим порта.

Разъём — свойство модели техники и живёт в шаблоне; модуль вставляется в
клетку у конкретной железки; режим (доступ/транк) настраивается только на
устройстве.
"""

import pytest


@pytest.fixture
def connectors(client, headers):
    """Стартовый набор разъёмов. В рабочей базе его кладёт миграция (это
    проверяется в test_migrations), а здесь таблицы чистятся перед каждым
    тестом, поэтому нужное заводим сами."""
    rows = {}
    for name, media, is_cage in [("RJ45", "copper", False), ("SFP+", "other", True), ("LC", "fiber", False)]:
        response = client.post(
            "/connector-types", json={"name": name, "media": media, "is_cage": is_cage},
            headers=headers["editor"],
        )
        rows[name] = response.json()
    return rows


def test_connector_in_use_cannot_be_deleted(client, headers, connectors, template):
    """Молча обнулить разъём у сотни портов — потерять данные."""
    port = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()["interfaces"][0]
    client.patch(
        f"/device-templates/{template.id}/interfaces/{port['id']}",
        json={"connector_id": connectors["RJ45"]["id"]}, headers=headers["editor"],
    )
    response = client.delete(f"/connector-types/{connectors['RJ45']['id']}", headers=headers["editor"])
    assert response.status_code == 409
    assert "использу" in response.json()["detail"]


def test_template_port_edit_reaches_devices(client, headers, connectors, template, make_device):
    """Порт устройства — копия порта модели: правка подписи и разъёма
    доезжает до всех железок этой модели."""
    device = make_device()
    port = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()["interfaces"][0]

    response = client.patch(
        f"/device-templates/{template.id}/interfaces/{port['id']}",
        json={"label": "Gi0/1", "connector_id": connectors["SFP+"]["id"]},
        headers=headers["editor"],
    )
    assert response.status_code == 200

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    first = refreshed["interfaces"][0]
    assert first["label"] == "Gi0/1"
    assert first["connector"]["name"] == "SFP+"
    # Клетка без модуля: порт есть, а воткнуть в него нечего.
    assert first["empty_cage"] is True
    assert first["connector_effective"]["name"] == "SFP+"


def test_module_gives_the_port_its_connector(client, headers, connectors, template, make_device):
    device = make_device()
    port = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()["interfaces"][0]
    client.patch(
        f"/device-templates/{template.id}/interfaces/{port['id']}",
        json={"connector_id": connectors["SFP+"]["id"]}, headers=headers["editor"],
    )
    module = client.post(
        "/modules",
        json={
            "name": "SFP-10G-LR",
            "cage_connector_id": connectors["SFP+"]["id"],
            "connector_id": connectors["LC"]["id"],
        },
        headers=headers["editor"],
    ).json()

    device_port = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"][0]
    client.patch(f"/interfaces/{device_port['id']}", json={"module_id": module["id"]}, headers=headers["editor"])

    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"][0]
    assert refreshed["module"]["name"] == "SFP-10G-LR"
    # Наружу торчит разъём модуля, а не клетка.
    assert refreshed["connector_effective"]["name"] == "LC"
    assert refreshed["empty_cage"] is False

    # Вынуть вставленный модуль из справочника нельзя.
    assert client.delete(f"/modules/{module['id']}", headers=headers["editor"]).status_code == 409


def test_mode_lives_on_the_device_only(client, headers, template, make_device):
    """В шаблоне режима нет: одинаковые коммутаторы настроены по-разному."""
    created = client.post(
        f"/device-templates/{template.id}/interfaces",
        json={"label": "SFP1", "mode": "trunk"}, headers=headers["editor"],
    )
    assert created.status_code == 201
    assert "mode" not in created.json()

    device = make_device()
    port = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"][0]
    client.patch(f"/interfaces/{port['id']}", json={"mode": "trunk"}, headers=headers["editor"])
    refreshed = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()["interfaces"][0]
    assert refreshed["mode"] == "trunk"


def test_device_type_can_be_renamed_without_touching_codes(client, headers, device_type, make_device):
    """Код напечатан на наклейке — смена префикса его не переписывает."""
    device = make_device()
    old_code = device["code"]

    response = client.patch(
        f"/device-types/{device_type.id}",
        json={"name": "Коммутатор доступа", "code_prefix": "swa"},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    assert response.json() == {**response.json(), "name": "Коммутатор доступа", "code_prefix": "SWA"}

    unchanged = client.get(f"/devices/{device['id']}", headers=headers["viewer"]).json()
    assert unchanged["code"] == old_code


def test_template_copy_repeats_ports(client, headers, template):
    copy = client.post(f"/device-templates/{template.id}/copy", headers=headers["editor"])
    assert copy.status_code == 201
    assert copy.json()["name"].endswith("(копия)")

    original = client.get(f"/device-templates/{template.id}", headers=headers["viewer"]).json()
    assert (
        [(p["port_number"], p["label"]) for p in copy.json()["interfaces"]]
        == [(p["port_number"], p["label"]) for p in original["interfaces"]]
    )


def test_renamed_device_type_survives_restart(client, headers, db):
    """Приложение сидирует типы при каждом старте. Переименованный тип по
    имени не находится, и раньше повторная вставка упиралась в занятый
    префикс — бэкенд не поднимался вовсе."""
    from app import models
    from app.main import prepare_reference_data

    db.add(models.DeviceType(name="Коммутатор", code_prefix="SW"))
    db.commit()

    renamed = client.get("/device-types", headers=headers["viewer"]).json()[0]
    client.patch(f"/device-types/{renamed['id']}", json={"name": "Коммутатор доступа"}, headers=headers["editor"])

    prepare_reference_data()  # то же, что делает контейнер при запуске

    types = client.get("/device-types", headers=headers["viewer"]).json()
    prefixes = [t["code_prefix"] for t in types]
    assert len(prefixes) == len(set(prefixes)), "префиксы остаются уникальными"
    assert "Коммутатор доступа" in [t["name"] for t in types]
