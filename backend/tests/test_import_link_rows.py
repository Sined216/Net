"""Связи из обхода: промежуточные строки и их перенос (/import/link-rows).

Устройства из обхода разбираются готовым механизмом импорта из файла — им
занят test_import.py. Здесь про то, чего у импорта не было: связи. Главное
— опознание концов по тому, как их записали в цеху («свитч у окна»,
«порт 3»), и перенос строки в настоящую связь теми же проверками, что и у
обычного заведения.
"""

from app import models


def _row(db, site, **fields):
    row = models.ImportLinkRow(site_id=site.id, source="mobile", status="new", **fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_link_row_resolves_device_by_code(client, headers, db, site, make_device):
    """Устройство узнаётся по коду — так его и записывают, если человек
    смотрел на наклейку."""
    device = make_device(name="Свитч у окна")
    _row(db, site, a_device_text=device["code"], a_port_text="1")

    rows = client.get("/import/link-rows", headers=headers["editor"]).json()
    assert len(rows) == 1
    assert rows[0]["suggested_a_device_id"] == device["id"]
    assert rows[0]["suggested_a_device_code"] == device["code"]


def test_link_row_resolves_device_by_name_and_port_by_number(client, headers, db, site, make_device):
    """В поле чаще пишут название и голый номер гнезда, а не полную подпись
    порта."""
    device = make_device(name="Свитч у окна")
    _row(db, site, a_device_text="свитч у окна", a_port_text="2")

    row = client.get("/import/link-rows", headers=headers["editor"]).json()[0]
    assert row["suggested_a_device_id"] == device["id"]
    # Шаблон заводит порты «Порт 1» и «Порт 2» — по числу нашёлся второй.
    assert row["suggested_a_interface_label"] == "Порт 2"


def test_link_row_resolves_port_by_exact_label(client, headers, db, site, make_device):
    # Железка нужна самим фактом своего существования: строку с ней
    # сопоставляют по названию, а её id тут ни при чём.
    make_device(name="Свитч")
    _row(db, site, a_device_text="Свитч", a_port_text="Порт 1")

    row = client.get("/import/link-rows", headers=headers["editor"]).json()[0]
    assert row["suggested_a_interface_label"] == "Порт 1"


def test_known_device_id_beats_guessing_by_text(client, headers, db, site, make_device):
    """Номер, принесённый телефоном, вернее угадывания: телефон брал
    устройство из снимка, а не с чужих слов."""
    right = make_device(name="Нужный")
    make_device(name="Похожий")
    _row(db, site, a_device_id=right["id"], a_device_text="Похожий")

    row = client.get("/import/link-rows", headers=headers["editor"]).json()[0]
    assert row["suggested_a_device_id"] == right["id"]


def test_busy_port_is_marked(client, headers, db, site, make_device):
    """Гнездо уже занято другой связью — человек должен видеть это до
    переноса. Не запрет: в цеху могли переткнуть кабель."""
    a = make_device(name="A")
    b = make_device(name="B")
    client.post("/links", json={
        "interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"],
    }, headers=headers["editor"])

    _row(db, site, a_device_text="A", a_port_text="Порт 1")
    row = client.get("/import/link-rows", headers=headers["editor"]).json()[0]
    assert row["a_interface_busy"] is True


def test_unknown_device_leaves_row_without_suggestion(client, headers, db, site):
    """Ничего не опознали — строка всё равно видна: устройство выберут
    руками при переносе."""
    _row(db, site, a_device_text="Неизвестно что", a_port_text="7")
    row = client.get("/import/link-rows", headers=headers["editor"]).json()[0]
    assert row["suggested_a_device_id"] is None
    assert row["a_device_text"] == "Неизвестно что"


def test_move_link_row_creates_link_and_marks_row(client, headers, db, site, make_device):
    a = make_device(name="A")
    b = make_device(name="B")
    row = _row(db, site, a_device_text="A", b_device_text="B")

    response = client.post(
        f"/import/link-rows/{row.id}/move",
        json={
            "interface_a_id": a["interfaces"][0]["id"],
            "interface_b_id": b["interfaces"][0]["id"],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 201, response.text
    link_id = response.json()["id"]

    db.expire_all()
    moved = db.query(models.ImportLinkRow).filter(models.ImportLinkRow.id == row.id).one()
    assert moved.status == "moved"
    assert moved.link_id == link_id
    assert db.query(models.Link).count() == 1


def test_move_twice_is_refused(client, headers, db, site, make_device):
    a = make_device(name="A")
    b = make_device(name="B")
    row = _row(db, site, a_device_text="A", b_device_text="B")
    payload = {
        "interface_a_id": a["interfaces"][0]["id"],
        "interface_b_id": b["interfaces"][0]["id"],
    }
    assert client.post(f"/import/link-rows/{row.id}/move", json=payload,
                       headers=headers["editor"]).status_code == 201
    second = client.post(f"/import/link-rows/{row.id}/move", json=payload, headers=headers["editor"])
    assert second.status_code == 409


def test_move_into_busy_port_is_refused(client, headers, db, site, make_device):
    """Перенос идёт теми же проверками, что и обычное заведение связи —
    занятое гнездо отбивается так же."""
    a = make_device(name="A")
    b = make_device(name="B")
    c = make_device(name="C")
    client.post("/links", json={
        "interface_a_id": a["interfaces"][0]["id"], "interface_b_id": b["interfaces"][0]["id"],
    }, headers=headers["editor"])

    row = _row(db, site, a_device_text="A", b_device_text="C")
    response = client.post(
        f"/import/link-rows/{row.id}/move",
        json={
            "interface_a_id": a["interfaces"][0]["id"],
            "interface_b_id": c["interfaces"][0]["id"],
        },
        headers=headers["editor"],
    )
    assert response.status_code == 409


def test_viewer_cannot_move_or_delete(client, headers, db, site):
    row = _row(db, site, a_device_text="A")
    assert client.post(f"/import/link-rows/{row.id}/move", json={
        "interface_a_id": 1, "interface_b_id": 2,
    }, headers=headers["viewer"]).status_code == 403
    assert client.delete(f"/import/link-rows/{row.id}", headers=headers["viewer"]).status_code == 403


def test_delete_row_keeps_the_link(client, headers, db, site, make_device):
    """Убрали строку обхода — заведённая по ней связь остаётся: это уже
    спецификация, а не обход."""
    a = make_device(name="A")
    b = make_device(name="B")
    row = _row(db, site, a_device_text="A", b_device_text="B")
    client.post(f"/import/link-rows/{row.id}/move", json={
        "interface_a_id": a["interfaces"][0]["id"],
        "interface_b_id": b["interfaces"][0]["id"],
    }, headers=headers["editor"])

    assert client.delete(f"/import/link-rows/{row.id}", headers=headers["editor"]).status_code == 204
    assert db.query(models.ImportLinkRow).count() == 0
    assert db.query(models.Link).count() == 1


def test_clear_only_moved(client, headers, db, site, make_device):
    a = make_device(name="A")
    b = make_device(name="B")
    waiting = _row(db, site, a_device_text="ждёт")
    moved = _row(db, site, a_device_text="A", b_device_text="B")
    client.post(f"/import/link-rows/{moved.id}/move", json={
        "interface_a_id": a["interfaces"][0]["id"],
        "interface_b_id": b["interfaces"][0]["id"],
    }, headers=headers["editor"])

    assert client.delete("/import/link-rows?status=moved",
                         headers=headers["editor"]).status_code == 204
    left = db.query(models.ImportLinkRow).all()
    assert [r.id for r in left] == [waiting.id]
