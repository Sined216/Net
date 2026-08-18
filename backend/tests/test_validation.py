"""Проверка входных данных.

Колонки INET/CIDR/MACADDR отвергают мусор сами, но без проверки на входе
пользователь получал бы 500 вместо понятного 422 с указанием поля.
"""

import pytest


@pytest.mark.parametrize("value", ["10.10.1.2", "192.168.0.255", "2001:db8::1"])
def test_valid_management_ip_is_accepted(client, headers, template, value):
    response = client.post(
        "/devices", json={"template_id": template.id, "management_ip": value}, headers=headers["editor"]
    )
    assert response.status_code == 201, response.text
    assert response.json()["management_ip"] == value


@pytest.mark.parametrize("value", ["10.10.1.300", "не знаю", "10.10.1", "10.10.1.2/24", ""])
def test_invalid_management_ip_is_rejected(client, headers, template, value):
    response = client.post(
        "/devices", json={"template_id": template.id, "management_ip": value}, headers=headers["editor"]
    )
    assert response.status_code == 422, f"«{value}» приняли как IP"


def test_invalid_ip_message_names_the_field(client, headers, template):
    response = client.post(
        "/devices", json={"template_id": template.id, "management_ip": "не знаю"}, headers=headers["editor"]
    )
    detail = response.json()["detail"][0]
    assert detail["loc"][-1] == "management_ip"
    assert "IP" in detail["msg"]


@pytest.mark.parametrize(
    "written,stored",
    [
        ("a4:bb:6d:11:22:33", "a4:bb:6d:11:22:33"),
        ("A4-BB-6D-11-22-33", "a4:bb:6d:11:22:33"),
        ("a4bb.6d11.2233", "a4:bb:6d:11:22:33"),
        ("A4BB6D112233", "a4:bb:6d:11:22:33"),
    ],
)
def test_mac_is_normalized(client, headers, make_device, written, stored):
    """Один и тот же адрес пишут четырьмя способами — в базе он должен
    оказаться в одном виде, иначе поиск по MAC найдёт не всё."""
    device = make_device()
    response = client.patch(
        f"/interfaces/{device['interfaces'][0]['id']}", json={"mac": written}, headers=headers["editor"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["mac"] == stored


@pytest.mark.parametrize("value", ["a4:bb:6d:11:22", "zz:bb:6d:11:22:33", "просто текст"])
def test_invalid_mac_is_rejected(client, headers, make_device, value):
    device = make_device()
    response = client.patch(
        f"/interfaces/{device['interfaces'][0]['id']}", json={"mac": value}, headers=headers["editor"]
    )
    assert response.status_code == 422


def test_normalized_mac_is_searchable(client, headers, make_device):
    device = make_device()
    client.patch(
        f"/interfaces/{device['interfaces'][0]['id']}", json={"mac": "A4-BB-6D-11-22-33"}, headers=headers["editor"]
    )
    found = client.get("/search", params={"query": "a4:bb:6d"}, headers=headers["viewer"]).json()
    assert len(found) == 1
    assert found[0]["device_id"] == device["id"]


def test_ip_prefix_search_still_works(client, headers, make_device):
    """Поиск по началу адреса — «покажи всё из 10.10.» — не должен был
    сломаться от смены типа колонки на inet."""
    device = make_device()
    client.patch(
        f"/interfaces/{device['interfaces'][0]['id']}", json={"ip": "10.10.1.42"}, headers=headers["editor"]
    )
    found = client.get("/search", params={"query": "10.10."}, headers=headers["viewer"]).json()
    assert [f["ip"] for f in found] == ["10.10.1.42"]


@pytest.mark.parametrize(
    "written,stored",
    [
        ("10.10.1.0/24", "10.10.1.0/24"),
        # Привычная запись «адрес с маской» приводится к адресу сети —
        # иначе тип CIDR отверг бы её на уровне базы.
        ("10.10.1.5/24", "10.10.1.0/24"),
        ("2001:db8::/32", "2001:db8::/32"),
    ],
)
def test_valid_subnet_is_accepted(client, headers, written, stored):
    response = client.post(
        "/vlans", json={"vlan_number": 10, "subnet": written}, headers=headers["editor"]
    )
    assert response.status_code == 201, response.text
    assert response.json()["subnet"] == stored


@pytest.mark.parametrize("value", ["10.10.1.0/33", "подсеть цеха", "10.10.1.0/"])
def test_invalid_subnet_is_rejected(client, headers, value):
    response = client.post("/vlans", json={"vlan_number": 10, "subnet": value}, headers=headers["editor"])
    assert response.status_code == 422


def test_install_date_is_a_real_date(client, headers, template):
    ok = client.post(
        "/devices", json={"template_id": template.id, "install_date": "2024-03-15"}, headers=headers["editor"]
    )
    assert ok.status_code == 201
    assert ok.json()["install_date"] == "2024-03-15"

    bad = client.post(
        "/devices", json={"template_id": template.id, "install_date": "15 марта"}, headers=headers["editor"]
    )
    assert bad.status_code == 422


@pytest.mark.parametrize("field,value", [("mode", "магистральный"), ("mode", "ACCESS")])
def test_unknown_port_mode_is_rejected(client, headers, make_device, field, value):
    device = make_device()
    response = client.patch(
        f"/interfaces/{device['interfaces'][0]['id']}", json={field: value}, headers=headers["editor"]
    )
    assert response.status_code == 422


def test_unknown_device_role_is_rejected(client, headers, template):
    response = client.post(
        "/devices", json={"template_id": template.id, "role": "главный"}, headers=headers["editor"]
    )
    assert response.status_code == 422


def test_unknown_media_type_is_rejected(client, headers):
    response = client.post(
        "/link-templates", json={"name": "Странная", "media_type": "телепатия"}, headers=headers["editor"]
    )
    assert response.status_code == 422


def test_client_cannot_forge_link_source(client, headers, make_device):
    """source и confirmed — поля под будущий SNMP-опрос. Связь, заведённая
    руками, обязана остаться ручной, что бы ни прислал клиент."""
    a, b = make_device(), make_device()
    response = client.post(
        "/links",
        json={
            "interface_a_id": a["interfaces"][0]["id"],
            "interface_b_id": b["interfaces"][0]["id"],
            "source": "lldp",
            "confirmed": False,
        },
        headers=headers["editor"],
    )
    assert response.status_code == 201
    assert response.json()["source"] == "manual"
    assert response.json()["confirmed"] is True


def test_client_cannot_unforge_link_confirmed_via_patch(client, headers, make_device):
    """Тот же довод, что и выше, но для правки: PATCH /links/{id} не
    принимает confirmed от клиента вовсе — поле убрано из LinkUpdate, а не
    просто проигнорировано на сервере."""
    a, b = make_device(), make_device()
    link = client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()
    assert link["confirmed"] is True

    response = client.patch(
        f"/links/{link['id']}", json={"confirmed": False, "notes": "правка заодно"}, headers=headers["editor"]
    )
    assert response.status_code == 200
    assert response.json()["confirmed"] is True
    assert response.json()["notes"] == "правка заодно"


@pytest.mark.parametrize(
    "written,stored",
    [
        ("a4:bb:6d:11:22:33", "a4:bb:6d:11:22:33"),
        ("A4-BB-6D-11-22-33", "a4:bb:6d:11:22:33"),
        ("a4bb.6d11.2233", "a4:bb:6d:11:22:33"),
    ],
)
def test_device_mac_is_normalized(client, headers, make_device, written, stored):
    """У устройства свой MAC — управляющий, не портовый. Приводится к одному
    виду той же базой и по той же причине, что и у порта."""
    device = make_device()
    response = client.patch(
        f"/devices/{device['id']}", json={"mac": written}, headers=headers["editor"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["mac"] == stored


def test_invalid_device_mac_is_rejected(client, headers, make_device):
    device = make_device()
    response = client.patch(
        f"/devices/{device['id']}", json={"mac": "не мак"}, headers=headers["editor"]
    )
    assert response.status_code == 422


@pytest.mark.parametrize("query", ["a4:bb", "A4-BB", "a4bb6d", "A4BB6D1122"])
def test_device_mac_is_searchable_in_any_notation(client, headers, make_device, query):
    """Искать MAC приходится тем, что скопировали из чужой выгрузки, — а там
    разделители любые. Отбор списка устройств не должен от этого зависеть."""
    device = make_device()
    client.patch(f"/devices/{device['id']}", json={"mac": "A4-BB-6D-11-22-33"}, headers=headers["editor"])

    page = client.get("/devices", params={"q": query}, headers=headers["viewer"]).json()
    assert [item["id"] for item in page["items"]] == [device["id"]]


def test_device_mac_has_its_own_filter_column(client, headers, make_device):
    """Отдельная колонка отбора — та же нормализация, что и у общего поиска,
    но без него: набрали код в одной колонке и MAC в другой, оба условия
    должны сложиться."""
    device = make_device()
    other = make_device()
    client.patch(f"/devices/{device['id']}", json={"mac": "A4-BB-6D-11-22-33"}, headers=headers["editor"])
    client.patch(f"/devices/{other['id']}", json={"mac": "00-11-22-33-44-55"}, headers=headers["editor"])

    page = client.get("/devices", params={"mac": "a4bb"}, headers=headers["viewer"]).json()
    assert [item["id"] for item in page["items"]] == [device["id"]]
