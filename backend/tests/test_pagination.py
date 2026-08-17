"""Список устройств на настоящем объёме.

Цель — тысяча устройств и двадцать четыре тысячи портов. При старой схеме
(«отдать всё одним ответом со всеми портами») список умирал задолго до неё:
браузеру привозили двадцать четыре тысячи вложенных объектов, чтобы
показать пятьдесят строк.

Здесь проверяется, что список стал лёгким и страничным, а отбор и поиск
делает база.
"""

import json
import time

import pytest

from app import models


@pytest.fixture
def many_devices(client, headers, template, db):
    """Полсотни устройств с портами — хватает, чтобы поймать и постраничность,
    и лишние запросы: их число не должно расти вместе с числом устройств."""
    for n in range(50):
        response = client.post(
            "/devices",
            json={"template_id": template.id, "name": f"Станок {n:02d}", "location": f"Цех {n % 3}"},
            headers=headers["editor"],
        )
        assert response.status_code == 201
    return db.query(models.Device).count()


def test_list_is_light_and_paged(client, headers, many_devices):
    """Порты в списке не приезжают — вместо них счётчики."""
    response = client.get("/devices", params={"limit": 10}, headers=headers["viewer"])
    body = response.json()

    assert body["total"] == 50
    assert len(body["items"]) == 10
    first = body["items"][0]
    assert "interfaces" not in first, "порты в списке не нужны — они и делали его тяжёлым"
    assert first["ports_total"] == 2
    assert first["ports_connected"] == 0


def test_paging_walks_through_everything(client, headers, many_devices):
    seen = []
    for offset in range(0, 50, 20):
        page = client.get("/devices", params={"limit": 20, "offset": offset},
                          headers=headers["viewer"]).json()
        seen.extend(item["code"] for item in page["items"])
    assert len(seen) == 50
    assert len(set(seen)) == 50, "страницы не должны перекрываться"
    assert seen == sorted(seen), "порядок по коду — устойчивый, иначе страницы поедут"


def test_search_and_filters_are_done_by_the_database(client, headers, many_devices):
    found = client.get("/devices", params={"q": "Станок 07"}, headers=headers["viewer"]).json()
    assert found["total"] == 1
    assert found["items"][0]["name"] == "Станок 07"

    by_place = client.get("/devices", params={"q": "Цех 1"}, headers=headers["viewer"]).json()
    assert by_place["total"] > 1

    # Спецсимволы ILIKE — это текст, а не шаблон.
    assert client.get("/devices", params={"q": "%"}, headers=headers["viewer"]).json()["total"] == 0


def test_sorting(client, headers, many_devices):
    desc = client.get("/devices", params={"sort": "code", "desc": True, "limit": 3},
                      headers=headers["viewer"]).json()
    codes = [i["code"] for i in desc["items"]]
    assert codes == sorted(codes, reverse=True)


def test_ports_counted_including_dangling(client, headers, make_device):
    """Порт с подвешенным кабелем занят: кабель-то в него воткнут."""
    one = make_device()
    two = make_device()
    client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"], "interface_b_id": two["interfaces"][0]["id"],
    }, headers=headers["editor"])

    listed = client.get("/devices", headers=headers["viewer"]).json()["items"]
    assert all(item["ports_connected"] == 1 for item in listed)


def test_response_stays_small(client, headers, many_devices):
    """Приёмка ТЗ: первый ответ списка — меньше 200 КБ.

    Пятьдесят устройств здесь по два порта; при старой схеме на целевых
    двадцати четырёх портах тот же ответ раздувался в разы, и это ещё без
    тысячи устройств.
    """
    response = client.get("/devices", params={"limit": 50}, headers=headers["viewer"])
    size = len(json.dumps(response.json()).encode())
    assert size < 200 * 1024, f"ответ вырос до {size} байт"


def test_queries_do_not_multiply_with_devices(client, headers, template, db):
    """Число запросов на страницу не должно зависеть от числа устройств.

    Именно так список и становится медленным: не одним тяжёлым запросом, а
    полусотней лёгких — по одному на карточку.
    """
    from sqlalchemy import event
    from app.database import engine

    for n in range(30):
        client.post("/devices", json={"template_id": template.id, "name": f"Станок {n}"},
                    headers=headers["editor"])

    counted = []
    def count(*args, **kwargs):
        counted.append(1)

    event.listen(engine, "before_cursor_execute", count)
    try:
        client.get("/devices", params={"limit": 5}, headers=headers["viewer"])
        few = len(counted)
        counted.clear()
        client.get("/devices", params={"limit": 30}, headers=headers["viewer"])
        many = len(counted)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert many <= few + 1, f"на 5 устройств {few} запросов, на 30 — {many}"


def test_links_come_with_labels(client, headers, make_device):
    """Страница связей не должна ради подписей везти все устройства."""
    one = make_device(name="Первый")
    two = make_device(name="Второй")
    client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"], "interface_b_id": two["interfaces"][0]["id"],
    }, headers=headers["editor"])

    page = client.get("/links", headers=headers["viewer"]).json()
    assert page["total"] == 1
    link = page["items"][0]
    assert link["end_a"]["device_code"] == one["code"]
    assert link["end_a"]["port_number"] == 1
    assert link["end_b"]["device_name"] == "Второй"


def test_links_filtered_by_device(client, headers, make_device):
    one = make_device()
    two = make_device()
    three = make_device()
    client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"], "interface_b_id": two["interfaces"][0]["id"],
    }, headers=headers["editor"])
    client.post("/links", json={
        "interface_a_id": two["interfaces"][1]["id"], "interface_b_id": three["interfaces"][0]["id"],
    }, headers=headers["editor"])

    assert client.get("/links", params={"device_id": one["id"]},
                      headers=headers["viewer"]).json()["total"] == 1
    assert client.get("/links", params={"device_id": two["id"]},
                      headers=headers["viewer"]).json()["total"] == 2


def test_free_ports_are_found_by_the_database(client, headers, make_device):
    """Список «куда воткнуть» собирается на сервере, а не из всех устройств."""
    one = make_device(name="Первый")
    two = make_device(name="Второй")
    client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"], "interface_b_id": two["interfaces"][0]["id"],
    }, headers=headers["editor"])

    free = client.get("/interfaces/free", headers=headers["viewer"]).json()
    busy_ids = {one["interfaces"][0]["id"], two["interfaces"][0]["id"]}
    assert busy_ids.isdisjoint({p["interface_id"] for p in free})
    assert len(free) == 2

    # Свой же порт в списке не нужен: сам с собой порт не соединяют.
    without_own = client.get("/interfaces/free", params={"exclude_device_id": one["id"]},
                             headers=headers["viewer"]).json()
    assert all(p["device_id"] != one["id"] for p in without_own)

    by_name = client.get("/interfaces/free", params={"q": "Второй"}, headers=headers["viewer"]).json()
    assert all(p["device_name"] == "Второй" for p in by_name)

    # Список, суженный до одной железки: правка связи спрашивает именно его,
    # чтобы порт не потерялся за общим лимитом на площадке с большим числом
    # свободных портов.
    only_two = client.get("/interfaces/free", params={"device_id": two["id"]},
                          headers=headers["viewer"]).json()
    assert only_two and all(p["device_id"] == two["id"] for p in only_two)


def test_topology_no_longer_hauls_every_port(client, headers, make_device):
    """У схемы свой маршрут, и он тоже стал лёгким: карточке достаточно
    счётчиков. Подробности — в `test_topology.py`."""
    make_device()
    body = client.get("/topology", headers=headers["viewer"]).json()
    assert body["nodes"] and "interfaces" not in body["nodes"][0]
    assert body["nodes"][0]["ports_total"] == 2


def test_page_is_fast_enough(client, headers, many_devices):
    """Грубая проверка порядка величины: страница списка — доли секунды."""
    started = time.perf_counter()
    client.get("/devices", params={"limit": 50}, headers=headers["viewer"])
    elapsed = time.perf_counter() - started
    assert elapsed < 1.5, f"страница списка отдавалась {elapsed:.2f} с"
