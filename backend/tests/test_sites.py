"""Изоляция площадок: сети разных фабрик не пересекаются.

Проверяем обе линии обороны. Первая — приложение: чужого не видно ни в
списках, ни поиском, ни по прямой ссылке. Вторая — сама база: составные
внешние ключи не дают записать кабель между площадками, даже если запрос
идёт мимо приложения.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import auth, models


@pytest.fixture
def two_sites(db, site):
    """Вторая площадка рядом с той, что заводит общая фикстура."""
    other = models.Site(name="Вторая фабрика")
    db.add(other)
    db.commit()
    db.refresh(other)
    return site, other


@pytest.fixture
def local_editor(db, two_sites):
    """Человек, которому назначена только первая площадка."""
    _, other = two_sites
    user = models.User(
        full_name="Местный", username="local", password_hash="x", role="editor",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.execute(models.user_sites.insert().values(user_id=user.id, site_id=two_sites[0].id))
    db.commit()
    return user


def token(user) -> dict:
    return {"Authorization": f"Bearer {auth.create_access_token({'sub': str(user.id), 'role': user.role})}"}


def at(site, headers) -> dict:
    return {**headers, "X-Site-Id": str(site.id)}


def test_devices_of_another_site_are_invisible(client, headers, template, two_sites):
    """Ни в списке, ни поиском, ни по прямой ссылке."""
    first, second = two_sites
    mine = client.post("/devices", json={"template_id": template.id, "name": "Своё"},
                       headers=at(first, headers["admin"])).json()
    theirs = client.post("/devices", json={"template_id": template.id, "name": "Чужое"},
                         headers=at(second, headers["admin"])).json()

    listed = client.get("/devices", headers=at(first, headers["admin"])).json()["items"]
    assert [d["id"] for d in listed] == [mine["id"]]

    # Прямая ссылка на чужое устройство — 404, а не 403: чужие данные не
    # должны подтверждать даже своё существование.
    assert client.get(f"/devices/{theirs['id']}", headers=at(first, headers["admin"])).status_code == 404

    found = client.get("/search", params={"query": "Чуж"}, headers=at(first, headers["admin"])).json()
    assert found == []


def test_names_repeat_between_sites(client, headers, two_sites):
    """«Цех 1» и VLAN 10 есть на каждой фабрике — и это разные вещи."""
    first, second = two_sites
    for site in (first, second):
        assert client.post("/tags", json={"name": "Цех 1"},
                           headers=at(site, headers["admin"])).status_code == 201
        assert client.post("/vlans", json={"vlan_number": 10, "name": "Технологическая"},
                           headers=at(site, headers["admin"])).status_code == 201
        assert client.post("/topology-groups", json={"name": "Линия сборки"},
                           headers=at(site, headers["admin"])).status_code == 201

    # А внутри одной площадки повтор по-прежнему запрещён.
    assert client.post("/vlans", json={"vlan_number": 10},
                       headers=at(first, headers["admin"])).status_code == 409


def test_link_between_sites_is_refused_by_the_database(db, client, headers, template, two_sites):
    """Главная гарантия: кабель между фабриками не записывается в принципе.

    Запрос идёт мимо приложения — прямым INSERT, как это сделала бы ошибка
    в коде или чужой скрипт.
    """
    first, second = two_sites
    mine = client.post("/devices", json={"template_id": template.id},
                       headers=at(first, headers["admin"])).json()
    theirs = client.post("/devices", json={"template_id": template.id},
                         headers=at(second, headers["admin"])).json()
    a = mine["interfaces"][0]["id"]
    b = theirs["interfaces"][0]["id"]

    with pytest.raises(IntegrityError):
        db.execute(text(
            "INSERT INTO links (site_id, interface_a_id, interface_b_id, source, confirmed) "
            "VALUES (:site, :a, :b, 'manual', true)"
        ), {"site": first.id, "a": min(a, b), "b": max(a, b)})
        db.commit()
    db.rollback()


def test_port_cannot_be_moved_to_another_site(db, client, headers, template, two_sites):
    """Порт держится за устройство своей площадки — тем же составным ключом."""
    first, second = two_sites
    mine = client.post("/devices", json={"template_id": template.id},
                       headers=at(first, headers["admin"])).json()
    theirs = client.post("/devices", json={"template_id": template.id},
                         headers=at(second, headers["admin"])).json()

    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE interfaces SET device_id = :other WHERE id = :id"),
                   {"other": theirs["id"], "id": mine["interfaces"][0]["id"]})
        db.commit()
    db.rollback()


def test_dangling_end_survives_port_removal(db, client, headers, device_type, two_sites):
    """Составной ключ не должен ломать подвешенные концы.

    `ON DELETE SET NULL` перечисляет колонку: обнуляется ссылка на порт, а
    площадка кабеля остаётся — иначе снятие порта упиралось бы в NOT NULL.
    """
    first, _ = two_sites
    template = models.DeviceTemplate(
        name="Со съёмными портами", device_type_id=device_type.id, ports_editable_on_device=True,
    )
    db.add(template)
    db.flush()
    for n in (1, 2):
        db.add(models.InterfaceTemplate(template_id=template.id, port_number=n, label=f"Порт {n}"))
    db.commit()

    one = client.post("/devices", json={"template_id": template.id},
                      headers=at(first, headers["admin"])).json()
    two = client.post("/devices", json={"template_id": template.id},
                      headers=at(first, headers["admin"])).json()
    link = client.post("/links", json={
        "interface_a_id": one["interfaces"][0]["id"], "interface_b_id": two["interfaces"][0]["id"],
    }, headers=at(first, headers["admin"]))
    assert link.status_code == 201, link.text

    removed = client.delete(f"/interfaces/{one['interfaces'][0]['id']}", headers=at(first, headers["admin"]))
    assert removed.status_code == 204, removed.text

    remaining = client.get("/links", headers=at(first, headers["admin"])).json()["items"]
    assert len(remaining) == 1
    assert remaining[0]["interface_a_id"] is None or remaining[0]["interface_b_id"] is None


def test_user_sees_only_assigned_sites(client, headers, local_editor, two_sites):
    first, second = two_sites
    mine = token(local_editor)

    listed = client.get("/sites", headers=mine).json()
    assert [s["id"] for s in listed] == [first.id]

    # Чужая площадка — 404 и на явное указание заголовком.
    assert client.get("/devices", headers=at(second, mine)).status_code == 404
    # Своя работает и без заголовка: площадка одна, выбирать не из чего.
    assert client.get("/devices", headers=mine).status_code == 200


def test_admin_must_choose_when_there_are_several(client, headers, two_sites):
    """У администратора площадок несколько, и молча угадывать нельзя."""
    response = client.get("/devices", headers=headers["admin"])
    assert response.status_code == 400
    assert "площадка" in response.json()["detail"].lower()


def test_only_admin_manages_sites(client, headers):
    assert client.post("/sites", json={"name": "Третья"}, headers=headers["editor"]).status_code == 403
    assert client.post("/sites", json={"name": "Третья"}, headers=headers["admin"]).status_code == 201


def test_site_with_equipment_is_not_deleted(client, headers, template, two_sites):
    """Удаление площадки уносит всё её оборудование — поэтому непустую не
    отдаём."""
    first, _ = two_sites
    client.post("/devices", json={"template_id": template.id}, headers=at(first, headers["admin"]))
    response = client.delete(f"/sites/{first.id}", headers=headers["admin"])
    assert response.status_code == 409
    assert "устройств" in response.json()["detail"]


def test_access_list_is_editable(client, headers, users, two_sites):
    first, second = two_sites
    viewer = users["viewer"]
    response = client.put(f"/sites/{second.id}/access", json={"user_ids": [viewer.id]},
                          headers=headers["admin"])
    assert response.status_code == 200
    assert client.get(f"/sites/{second.id}/access", headers=headers["admin"]).json() == [viewer.id]

    # Теперь у viewer две площадки, и без заголовка нужный выбор неочевиден.
    assert client.get("/devices", headers=headers["viewer"]).status_code == 400
    assert client.get("/devices", headers=at(second, headers["viewer"])).status_code == 200


def test_device_codes_stay_unique_across_sites(client, headers, template, two_sites):
    """Нумерация сквозная: «упал SW-0042» звучит однозначно на всю систему."""
    first, second = two_sites
    one = client.post("/devices", json={"template_id": template.id},
                      headers=at(first, headers["admin"])).json()
    two = client.post("/devices", json={"template_id": template.id},
                      headers=at(second, headers["admin"])).json()
    assert one["code"] != two["code"]
