"""Транковые VLAN порта.

Раньше это был массив чисел в колонке порта — единственное место схемы, где
не проверялось ничего: в него ложился и удалённый VLAN, и VLAN чужой
площадки. Теперь это отдельная таблица с теми же составными ключами, что и
везде, и правило «транк только своей площадки» держит сама база.
"""

import pytest

from app import models


@pytest.fixture
def vlans(db, site):
    """Пара VLAN на площадке теста."""
    made = []
    for number, name in ((10, "Технологический"), (20, "Офисный")):
        vlan = models.Vlan(site_id=site.id, vlan_number=number, name=name)
        db.add(vlan)
        made.append(vlan)
    db.commit()
    for vlan in made:
        db.refresh(vlan)
    return made


def port_of(device):
    return device["interfaces"][0]["id"]


def test_trunk_vlans_are_saved_and_returned(client, headers, make_device, vlans):
    device = make_device()
    response = client.patch(
        f"/interfaces/{port_of(device)}",
        json={"mode": "trunk", "trunk_vlan_ids": [vlans[1].id, vlans[0].id]},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    # Наружу — по-прежнему список чисел, по возрастанию.
    assert response.json()["trunk_vlan_ids"] == sorted([vlans[0].id, vlans[1].id])

    again = client.get(f"/devices/{device['id']}/interfaces", headers=headers["viewer"]).json()
    assert again[0]["trunk_vlan_ids"] == sorted([vlans[0].id, vlans[1].id])


def test_trunk_list_is_replaced_not_merged(client, headers, make_device, vlans):
    device = make_device()
    port = port_of(device)
    client.patch(f"/interfaces/{port}", json={"trunk_vlan_ids": [vlans[0].id, vlans[1].id]},
                 headers=headers["editor"])
    response = client.patch(f"/interfaces/{port}", json={"trunk_vlan_ids": [vlans[1].id]},
                            headers=headers["editor"])
    assert response.json()["trunk_vlan_ids"] == [vlans[1].id]

    empty = client.patch(f"/interfaces/{port}", json={"trunk_vlan_ids": []}, headers=headers["editor"])
    assert empty.json()["trunk_vlan_ids"] is None


def test_unknown_vlan_is_rejected(client, headers, make_device, vlans):
    """Раньше принималось любое число: `[999999]` доезжало до базы и жило
    там, пока кто-нибудь не удивится."""
    device = make_device()
    response = client.patch(
        f"/interfaces/{port_of(device)}",
        json={"trunk_vlan_ids": [vlans[0].id, 999999]},
        headers=headers["editor"],
    )
    assert response.status_code == 404
    assert "999999" in response.json()["detail"]
    # Ничего не записалось: отбой целиком, а не «сколько получилось».
    ifaces = client.get(f"/devices/{device['id']}/interfaces", headers=headers["viewer"]).json()
    assert ifaces[0]["trunk_vlan_ids"] is None


def test_vlan_of_another_site_is_rejected(client, headers, make_device, vlans, db):
    """VLAN чужой площадки в транк не попадает — ни через API, ни в базу."""
    other_site = models.Site(name="Вторая фабрика")
    db.add(other_site)
    db.flush()
    alien = models.Vlan(site_id=other_site.id, vlan_number=99, name="Чужой")
    db.add(alien)
    db.commit()

    device = make_device()
    response = client.patch(
        f"/interfaces/{port_of(device)}",
        json={"trunk_vlan_ids": [alien.id]},
        headers=headers["editor"],
    )
    assert response.status_code == 404


def test_alien_vlan_is_refused_by_the_database_itself(db, site, make_device, vlans):
    """Последняя линия — сама база: даже прямой вставкой мимо приложения
    чужой VLAN в транк не запишется."""
    import sqlalchemy

    other_site = models.Site(name="Третья фабрика")
    db.add(other_site)
    db.flush()
    alien = models.Vlan(site_id=other_site.id, vlan_number=77, name="Чужой")
    db.add(alien)
    db.commit()

    device = make_device()
    port = device["interfaces"][0]["id"]
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db.execute(
            sqlalchemy.text(
                "INSERT INTO interface_trunk_vlans (interface_id, vlan_id, site_id) "
                "VALUES (:port, :vlan, :site)"
            ),
            {"port": port, "vlan": alien.id, "site": site.id},
        )
        db.commit()
    db.rollback()


def test_deleted_vlan_disappears_from_trunks(client, headers, make_device, vlans):
    """Удалили VLAN — он сам ушёл из транков. Раньше в массиве оставался
    идентификатор, за которым уже ничего не стоит."""
    device = make_device()
    port = port_of(device)
    client.patch(f"/interfaces/{port}", json={"trunk_vlan_ids": [vlans[0].id, vlans[1].id]},
                 headers=headers["editor"])

    assert client.delete(f"/vlans/{vlans[0].id}", headers=headers["editor"]).status_code == 204

    ifaces = client.get(f"/devices/{device['id']}/interfaces", headers=headers["viewer"]).json()
    assert ifaces[0]["trunk_vlan_ids"] == [vlans[1].id]


def test_deleting_port_takes_its_trunks_with_it(client, headers, make_device, vlans, db):
    device = make_device()
    port = port_of(device)
    client.patch(f"/interfaces/{port}", json={"trunk_vlan_ids": [vlans[0].id]}, headers=headers["editor"])
    client.delete(f"/devices/{device['id']}", headers=headers["editor"])
    assert db.query(models.InterfaceTrunkVlan).count() == 0
