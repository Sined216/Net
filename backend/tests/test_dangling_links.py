"""Подвешенные концы связей.

Сценарий из жизни: с ПК сняли сетевую карту. Порт исчез, но кабель остался
проложен и никуда не делся — связь должна пережить удаление порта с одним
пустым концом, а потом подключиться к новой карте.

Раньше удаление порта каскадом уносило и связь: кабель молча пропадал из
документации, хотя физически оставался в стене.
"""

import pytest


@pytest.fixture
def pc_template(client, headers, device_type, db):
    """Модель с изменяемым составом портов — как ПК со съёмной сетевой картой."""
    from app import models

    template = models.DeviceTemplate(
        name="ПК офисный", device_type_id=device_type.id, ports_editable_on_device=True,
    )
    db.add(template)
    db.flush()
    db.add(models.InterfaceTemplate(template_id=template.id, label="eth0", port_number=1))
    db.commit()
    db.refresh(template)
    return template


@pytest.fixture
def linked_pair(client, headers, make_device, pc_template):
    """Коммутатор и ПК, соединённые кабелем."""
    switch = make_device()
    pc = client.post("/devices", json={"template_id": pc_template.id}, headers=headers["editor"]).json()
    link = client.post(
        "/links",
        json={"interface_a_id": switch["interfaces"][0]["id"], "interface_b_id": pc["interfaces"][0]["id"]},
        headers=headers["editor"],
    ).json()
    return {"switch": switch, "pc": pc, "link": link, "pc_port": pc["interfaces"][0]["id"]}


def test_removing_port_leaves_link_dangling(client, headers, linked_pair):
    """Сняли сетевую карту — кабель остался, но его конец повис."""
    assert client.delete(f"/interfaces/{linked_pair['pc_port']}", headers=headers["editor"]).status_code == 204

    links = client.get("/links", headers=headers["viewer"]).json()
    assert len(links) == 1, "связь не должна была исчезнуть вместе с портом"

    link = links[0]
    ends = [link["interface_a_id"], link["interface_b_id"]]
    assert None in ends, "конец, где был удалённый порт, должен опустеть"
    assert any(e is not None for e in ends), "второй конец должен остаться на месте"


def test_switch_port_stays_busy_while_the_other_end_dangles(client, headers, linked_pair):
    """Кабель всё ещё воткнут в коммутатор, поэтому его порт занят —
    предлагать этот порт для нового подключения нельзя."""
    client.delete(f"/interfaces/{linked_pair['pc_port']}", headers=headers["editor"])

    switch = client.get(f"/devices/{linked_pair['switch']['id']}", headers=headers["viewer"]).json()
    port = switch["interfaces"][0]
    assert port["link_id"] is not None, "порт занят подвешенным кабелем"
    assert port["connected_to"] is None, "но показывать «подключён к» нечего"


def test_dangling_end_reattaches_to_a_new_port(client, headers, linked_pair):
    """Поставили новую сетевую карту — воткнули в неё тот же кабель.
    Связь та же самая: её длина, разъём и заметки не теряются."""
    client.patch(
        f"/links/{linked_pair['link']['id']}",
        json={"connector_type": "RJ45", "length_m": 12.5},
        headers=headers["editor"],
    )
    client.delete(f"/interfaces/{linked_pair['pc_port']}", headers=headers["editor"])

    new_port = client.post(
        f"/devices/{linked_pair['pc']['id']}/interfaces",
        json={"label": "eth1", "port_number": 2},
        headers=headers["editor"],
    ).json()

    response = client.post(
        f"/links/{linked_pair['link']['id']}/attach",
        json={"interface_id": new_port["id"]},
        headers=headers["editor"],
    )
    assert response.status_code == 200

    link = response.json()
    assert link["id"] == linked_pair["link"]["id"], "должна быть та же связь, а не новая"
    assert link["connector_type"] == "RJ45"
    assert link["length_m"] == 12.5
    assert link["interface_a_id"] is not None and link["interface_b_id"] is not None
    assert new_port["id"] in (link["interface_a_id"], link["interface_b_id"])


def test_attaching_to_a_busy_port_is_rejected(client, headers, linked_pair, make_device):
    client.delete(f"/interfaces/{linked_pair['pc_port']}", headers=headers["editor"])

    other = make_device()
    busy_port = other["interfaces"][0]["id"]
    client.post(
        "/links",
        json={"interface_a_id": busy_port, "interface_b_id": other["interfaces"][1]["id"]},
        headers=headers["editor"],
    )

    response = client.post(
        f"/links/{linked_pair['link']['id']}/attach", json={"interface_id": busy_port}, headers=headers["editor"]
    )
    assert response.status_code == 409


def test_cannot_attach_to_a_link_with_both_ends_connected(client, headers, linked_pair, make_device):
    other = make_device()
    response = client.post(
        f"/links/{linked_pair['link']['id']}/attach",
        json={"interface_id": other["interfaces"][0]["id"]},
        headers=headers["editor"],
    )
    assert response.status_code == 409


def test_dangling_link_can_be_deleted(client, headers, linked_pair):
    """Кабель всё-таки вынули — подвешенную связь убирают целиком."""
    client.delete(f"/interfaces/{linked_pair['pc_port']}", headers=headers["editor"])

    assert client.delete(f"/links/{linked_pair['link']['id']}", headers=headers["editor"]).status_code == 204
    assert client.get("/links", headers=headers["viewer"]).json() == []


def _remove_template_port(client, headers, template_id, label):
    tpl = client.get(f"/device-templates/{template_id}", headers=headers["viewer"]).json()
    port_id = next(i["id"] for i in tpl["interfaces"] if i["label"] == label)
    response = client.delete(f"/device-templates/{template_id}/interfaces/{port_id}", headers=headers["editor"])
    assert response.status_code == 204, response.text


def test_removing_template_port_dangles_links_of_all_devices(client, headers, template, make_device):
    """Порт убрали из модели — он исчез у всех её экземпляров, а кабель
    остался подвешенным, а не пропал."""
    a, b = make_device(), make_device()
    client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][1]["id"]},
        headers=headers["editor"],
    )

    _remove_template_port(client, headers, template.id, "Порт 1")

    links = client.get("/links", headers=headers["viewer"]).json()
    assert len(links) == 1, "кабель не должен был исчезнуть вместе с портом"
    ends = [links[0]["interface_a_id"], links[0]["interface_b_id"]]
    assert None in ends and any(e is not None for e in ends)


def test_link_losing_both_ends_at_once_is_removed(client, headers, template, make_device):
    """Два одинаковых устройства воткнуты друг в друга одноимёнными портами.
    Убрали этот порт из модели — подвешивать нечего, оба конца исчезли, и
    связь удаляется целиком: запись без единого конца хранить бессмысленно."""
    a, b = make_device(), make_device()
    client.post(
        "/links",
        json={"interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"]},
        headers=headers["editor"],
    )

    _remove_template_port(client, headers, template.id, "Порт 1")

    assert client.get("/links", headers=headers["viewer"]).json() == []


def test_deleting_device_removes_links_entirely(client, headers, linked_pair):
    """А вот удаление устройства уносит связи целиком: железки больше нет в
    спецификации, и кабель «в никуда» — уже не документ, а мусор."""
    client.delete(f"/devices/{linked_pair['pc']['id']}", headers=headers["editor"])
    assert client.get("/links", headers=headers["viewer"]).json() == []
