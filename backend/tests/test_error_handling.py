"""Ошибки запроса не должны превращаться в пятисотки.

Ссылка на несуществующую запись — это ошибка клиента: ему нужен внятный
отказ, а не «Internal Server Error», после которого непонятно, что делать.
"""

import pytest


@pytest.fixture
def device(make_device):
    return make_device()


MISSING = 999999


def test_missing_references_are_rejected_cleanly(client, headers, device, template):
    """Ни один из этих запросов не должен доехать до базы и упасть там."""
    port = device["interfaces"][0]["id"]
    cases = [
        ("PATCH", f"/interfaces/{port}", {"vlan_id": MISSING}),
        ("PATCH", f"/interfaces/{port}", {"module_id": MISSING}),
        ("POST", f"/device-templates/{template.id}/interfaces", {"label": "p", "connector_id": MISSING}),
        ("POST", f"/device-templates/{template.id}/interfaces/bulk", {"count": 1, "connector_id": MISSING}),
        ("POST", "/modules", {"name": "М", "connector_id": MISSING}),
        ("POST", "/modules", {"name": "М2", "cage_connector_id": MISSING}),
    ]
    for method, path, body in cases:
        response = client.request(method, path, json=body, headers=headers["editor"])
        assert response.status_code < 500, f"{method} {path} → {response.status_code}"
        assert response.status_code in (404, 409, 422), f"{method} {path} → {response.status_code}"


def test_module_does_not_go_into_a_plain_socket(client, headers, device):
    """В RJ45 модуль физически не вставить — записывать такое нельзя."""
    connector = client.post(
        "/connector-types", json={"name": "SFP-проба", "media": "other", "is_cage": True},
        headers=headers["editor"],
    ).json()
    module = client.post(
        "/modules", json={"name": "SFP-проба-модуль", "cage_connector_id": connector["id"]},
        headers=headers["editor"],
    ).json()

    port = device["interfaces"][0]["id"]
    response = client.patch(f"/interfaces/{port}", json={"module_id": module["id"]}, headers=headers["editor"])
    assert response.status_code == 409
    assert "не вставляется" in response.json()["detail"]


@pytest.mark.parametrize("path,body", [
    ("/tags", {"name": ""}),
    ("/topology-groups", {"name": ""}),
    ("/link-templates", {"name": "", "media_type": "copper"}),
    ("/vlans", {"vlan_number": 0}),
    ("/vlans", {"vlan_number": 4095}),
])
def test_empty_names_and_impossible_numbers_are_rejected(client, headers, path, body):
    """Пустая строка в списке выглядит как сбой и ни на что не ссылается;
    VLAN вне 1..4094 не существует по стандарту."""
    assert client.post(path, json=body, headers=headers["editor"]).status_code == 422


def test_empty_template_name_is_rejected(client, headers, device_type):
    response = client.post(
        "/device-templates", json={"name": "", "device_type_id": device_type.id, "interfaces": []},
        headers=headers["editor"],
    )
    assert response.status_code == 422


def test_old_rows_stay_readable(client, headers, db):
    """Ограничения на ввод не должны мешать читать уже лежащее в базе.

    Записи, заведённые до появления ограничения (пустое название, VLAN вне
    диапазона), обязаны отдаваться списком: иначе ужесточение проверки
    молча ломает чтение всем — список возвращает 500 вместо данных."""
    from app import models

    db.add_all([
        models.Tag(name=""),
        models.Vlan(vlan_number=0, name=""),
        models.Vlan(vlan_number=4095),
        models.LinkTemplate(name="", media_type="copper"),
        models.ConnectorType(name="", media="copper"),
        models.TransceiverModule(name=""),
    ])
    device_type = models.DeviceType(name="Тип для старых данных", code_prefix="OLD")
    db.add(device_type)
    db.flush()
    template = models.DeviceTemplate(name="", device_type_id=device_type.id)
    db.add(template)
    db.flush()
    db.add(models.InterfaceTemplate(template_id=template.id, port_number=1, label=""))
    db.commit()

    for path in ["/tags", "/vlans", "/link-templates", "/connector-types", "/modules", "/device-templates"]:
        response = client.get(path, headers=headers["viewer"])
        assert response.status_code == 200, f"{path} → {response.status_code}: {response.text[:200]}"


def test_absurdly_long_device_name_is_rejected(client, headers, template):
    """Имя на пять тысяч символов ломает и списки, и схему; двухсот хватает
    любому названию станка."""
    response = client.post(
        "/devices", json={"template_id": template.id, "name": "Э" * 5000}, headers=headers["editor"],
    )
    assert response.status_code == 422
    ok = client.post("/devices", json={"template_id": template.id, "name": "Станок №5 (линия 3)"},
                     headers=headers["editor"])
    assert ok.status_code == 201
