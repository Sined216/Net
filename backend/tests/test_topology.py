"""Схема связей собирается на сервере.

Раньше её собирал браузер: тянул все устройства площадки со всеми портами
(`/topology/devices`) и страницу кабелей, а потом сшивал их сам. Порты
составляли почти весь вес ответа — двадцать четыре тысячи вложенных
объектов на тысячу устройств ради дроби «1/4» на карточке.

Здесь проверяется, что `/topology` отдаёт ровно то, что схема рисует, и что
вес ответа не растёт вместе с числом портов.
"""

import json

import pytest

from app import models


@pytest.fixture
def linked_pair(client, headers, make_device):
    """Два устройства, соединённых кабелем: минимальная схема, на которой
    видно и узлы, и ребро."""
    one = make_device(name="Первый")
    two = make_device(name="Второй")
    link = client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"],
        "interface_b_id": two["interfaces"][0]["id"],
    }, headers=headers["editor"])
    assert link.status_code == 201, link.text
    return one, two, link.json()


def test_nodes_carry_counts_instead_of_ports(client, headers, linked_pair):
    """На карточке видна дробь «подключено / всего» — значит нужны два числа,
    а не список портов."""
    one, _two, _link = linked_pair
    body = client.get("/topology", headers=headers["viewer"]).json()

    node = next(n for n in body["nodes"] if n["id"] == one["id"])
    assert "interfaces" not in node, "порты на схеме не нужны — они и делали ответ тяжёлым"
    assert node["ports_total"] == 2
    assert node["ports_connected"] == 1
    # Цвет и название модели схема раньше искала в отдельном запросе всех
    # шаблонов — со всеми их портами.
    assert node["template_name"] == "Тестовый коммутатор"
    assert node["device_type"] == "Коммутатор"


def test_node_carries_management_ip(client, headers, linked_pair):
    """Адрес управления показывается строкой на карточке — значит схема
    должна его отдавать. Раньше за ним приходилось идти в карточку
    устройства отдельным запросом."""
    one, _two, _link = linked_pair
    client.patch(f"/devices/{one['id']}", json={"management_ip": "10.10.5.7"}, headers=headers["editor"])

    body = client.get("/topology", headers=headers["viewer"]).json()
    node = next(n for n in body["nodes"] if n["id"] == one["id"])
    assert node["management_ip"] == "10.10.5.7"


def test_edges_carry_port_numbers_and_labels(client, headers, linked_pair):
    """Подпись у конца кабеля — «№1 · Порт 1»; и номер, и название приходят
    готовыми, чтобы их не искать по всем портам площадки."""
    one, two, link = linked_pair
    body = client.get("/topology", headers=headers["viewer"]).json()

    edge = next(e for e in body["edges"] if e["link_id"] == link["id"])
    assert {edge["device_a_id"], edge["device_b_id"]} == {one["id"], two["id"]}
    assert edge["port_a_number"] == 1 and edge["port_b_number"] == 1
    assert edge["interface_a_label"] == "Порт 1"
    assert edge["interface_b_label"] == "Порт 1"


def test_dangling_link_stays_on_the_schema(client, headers, linked_pair, template, db):
    """Порт удалили, кабель остался: схема рисует такой конец заглушкой,
    поэтому связь должна прийти — с пустой стороной, но прийти.

    Порты живут в шаблоне, поэтому и убираются оттуда: сняли из модели
    первый порт — он исчез у всех её устройств, а воткнутые в него кабели
    повисли. Ровно так это и происходит на практике.
    """
    one, two, link = linked_pair
    # Кабель идёт из первого порта одного устройства во второй порт другого,
    # чтобы снятие первого порта модели повесило ровно один конец.
    client.delete(f"/links/{link['id']}", headers=headers["editor"])
    again = client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"],
        "interface_b_id": two["interfaces"][1]["id"],
    }, headers=headers["editor"])
    assert again.status_code == 201, again.text
    link = again.json()

    first_port = db.query(models.InterfaceTemplate).filter(
        models.InterfaceTemplate.template_id == template.id,
        models.InterfaceTemplate.port_number == 1,
    ).one()
    response = client.delete(f"/device-templates/{template.id}/interfaces/{first_port.id}",
                             headers=headers["editor"])
    assert response.status_code == 204, response.text

    body = client.get("/topology", headers=headers["viewer"]).json()
    edge = next(e for e in body["edges"] if e["link_id"] == link["id"])
    assert edge["device_a_id"] is None or edge["device_b_id"] is None, "один конец повис"
    assert edge["device_a_id"] is not None or edge["device_b_id"] is not None, "второй на месте"

    # Освободившийся порт больше не занят — счётчик это видит.
    node = next(n for n in body["nodes"] if n["id"] == one["id"])
    assert node["ports_total"] == 1
    assert node["ports_connected"] == 0


def test_tag_filter_hides_devices_and_their_cables(client, headers, linked_pair, db, site):
    """Отбор по тегу прячет устройства — вместе с кабелями, которым больше
    не к чему цепляться."""
    one, _two, link = linked_pair
    tag = models.Tag(name="Цех 1", site_id=site.id)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    assert client.put(f"/devices/{one['id']}/tags", json={"tag_ids": [tag.id]},
                      headers=headers["editor"]).status_code == 200

    body = client.get("/topology", params={"tag_id": tag.id}, headers=headers["viewer"]).json()
    assert [n["id"] for n in body["nodes"]] == [one["id"]]
    assert not any(e["link_id"] == link["id"] for e in body["edges"]), \
        "второго устройства на схеме нет — рисовать кабель не к чему"


def test_response_does_not_grow_with_ports(client, headers, template, db, make_device):
    """Главное, ради чего всё затевалось: сорок портов на железке весят
    столько же, сколько два."""
    small = make_device(name="Двухпортовый")
    body_before = client.get("/topology", headers=headers["viewer"]).content

    for n in range(3, 41):
        db.add(models.InterfaceTemplate(template_id=template.id, label=f"Порт {n}", port_number=n))
    db.commit()
    big = make_device(name="Сорокапортовый")
    body_after = client.get("/topology", headers=headers["viewer"]).content

    # Прибавилась ровно одна карточка, а не тридцать восемь портов.
    grew = len(body_after) - len(body_before)
    assert grew < 400, f"ответ вырос на {grew} байт — похоже, порты всё-таки приезжают"

    node = next(n for n in json.loads(body_after)["nodes"] if n["id"] == big["id"])
    assert node["ports_total"] == 40
    assert small["id"] != big["id"]


def test_link_can_be_fetched_one_at_a_time(client, headers, linked_pair):
    """Окно правки связи открывается по одному кабелю: возить ради него
    страницу всех кабелей больше незачем."""
    _one, _two, link = linked_pair
    found = client.get(f"/links/{link['id']}", headers=headers["viewer"])
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["id"] == link["id"]
    assert body["end_a"]["device_code"], "концы приходят с подписями — их показывает окно"

    assert client.get("/links/999999", headers=headers["viewer"]).status_code == 404
