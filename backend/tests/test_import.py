"""Импорт устройств из файла через промежуточную таблицу.

Файл не заводит устройства сам: строки ложатся отдельно, человек переносит
их по одной. Проверяем и разбор (колонки называются как попало, данные
неполные), и перенос.
"""

import io

import pytest


def upload(client, headers, name: str, content: bytes):
    return client.post(
        "/import/devices",
        files={"file": (name, content, "application/octet-stream")},
        headers=headers["editor"],
    )


CSV_FILE = (
    "Наименование;Модель;IP-адрес;Расположение;Инвентарный номер\n"
    "Станок 1;Тестовый коммутатор;10.10.1.5;Цех 1;ИНВ-001\n"
    "Станок 2;;;;\n"                       # почти пустая строка — тоже принимается
    ";;;;\n"                               # совсем пустая — пропускается
    "Станок 3;Неизвестная модель;10.10.1.7;;\n"
).encode("utf-8")


def test_csv_is_parsed_with_unknown_columns_kept(client, headers):
    """Заголовки называются по-разному, лишние столбцы не выбрасываются."""
    response = upload(client, headers, "устройства.csv", CSV_FILE)
    assert response.status_code == 201
    assert response.json()["added"] == 3, "пустая строка не в счёт"

    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    first = rows[0]
    assert first["name"] == "Станок 1"
    assert first["template_name"] == "Тестовый коммутатор"
    assert first["management_ip"] == "10.10.1.5"
    assert first["location"] == "Цех 1"
    # Столбец, которому нет места в модели, сохранён как есть.
    assert first["extra"] == {"Инвентарный номер": "ИНВ-001"}
    assert first["status"] == "new"


def test_incomplete_rows_are_accepted(client, headers):
    """«Данные могут быть неполными» — строка с одним названием проходит."""
    upload(client, headers, "устройства.csv", CSV_FILE)
    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    lonely = [r for r in rows if r["name"] == "Станок 2"][0]
    assert lonely["template_name"] is None
    assert lonely["management_ip"] is None


def test_known_model_is_suggested(client, headers, template):
    """Модель из файла ищется в справочнике: найденную интерфейс подставит
    в окно устройства, ненайденную человек выберет сам."""
    content = (
        f"Имя,Модель\nСтанок,{template.name}\nДругой,Такой модели нет\n"
    ).encode("utf-8")
    upload(client, headers, "устройства.csv", content)

    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    known = [r for r in rows if r["name"] == "Станок"][0]
    unknown = [r for r in rows if r["name"] == "Другой"][0]
    assert known["suggested_template_id"] == template.id
    assert unknown["suggested_template_id"] is None


def test_existing_name_and_ip_are_marked(client, headers, template):
    """Файлы приносят повторно, и в них попадает уже заведённое. Строка
    остаётся переносимой, но совпадение видно до переноса."""
    device = client.post(
        "/devices",
        json={"template_id": template.id, "name": "Станок 1", "management_ip": "10.10.9.9"},
        headers=headers["editor"],
    ).json()

    content = (
        "Имя;IP-адрес\n"
        "станок 1;10.10.1.5\n"        # то же название (регистр не в счёт), адрес другой
        "Станок 42;10.10.9.9\n"       # название другое, адрес занят
        "Станок 43;10.10.1.7\n"       # ничего общего
    ).encode("utf-8")
    upload(client, headers, "устройства.csv", content)

    rows = {r["name"]: r for r in client.get("/import/rows", headers=headers["viewer"]).json()}
    assert rows["станок 1"]["same_name_device_id"] == device["id"]
    assert rows["станок 1"]["same_ip_device_id"] is None
    assert rows["Станок 42"]["same_ip_device_id"] == device["id"]
    assert rows["Станок 42"]["same_name_device_id"] is None
    assert rows["Станок 43"]["same_name_device_id"] is None
    assert rows["Станок 43"]["same_ip_device_id"] is None


def test_row_moves_into_the_specification(client, headers, template):
    """Перенос заводит устройство и помечает строку — с ссылкой на него."""
    upload(client, headers, "устройства.csv", CSV_FILE)
    row = client.get("/import/rows", headers=headers["viewer"]).json()[0]

    response = client.post(
        f"/import/rows/{row['id']}/move",
        json={"template_id": template.id, "name": "Станок 1", "management_ip": "10.10.1.5"},
        headers=headers["editor"],
    )
    assert response.status_code == 201
    device = response.json()
    assert device["name"] == "Станок 1"
    # Порты приехали из модели — устройство полноценное, а не заготовка.
    assert len(device["interfaces"]) == len(template.interfaces)

    moved = [r for r in client.get("/import/rows", headers=headers["viewer"]).json() if r["id"] == row["id"]][0]
    assert moved["status"] == "moved"
    assert moved["device_id"] == device["id"]

    # Повторный перенос той же строки — отказ, а не второе устройство.
    again = client.post(
        f"/import/rows/{row['id']}/move", json={"template_id": template.id}, headers=headers["editor"],
    )
    assert again.status_code == 409


def test_moved_row_is_visible_in_the_device_history(client, headers, template):
    """Заведение из импорта пишется в журнал с идентификатором устройства.

    Раньше записывалось с пустым: блок «последние изменения» на карточке
    отбирает по нему, и появление железки в спецификации нигде не
    показывалось."""
    upload(client, headers, "устройства.csv", CSV_FILE)
    row = client.get("/import/rows", headers=headers["viewer"]).json()[0]
    device = client.post(
        f"/import/rows/{row['id']}/move",
        json={"template_id": template.id, "name": "Станок 1"},
        headers=headers["editor"],
    ).json()

    history = client.get(
        "/audit", params={"entity_type": "device", "entity_id": device["id"]},
        headers=headers["viewer"],
    ).json()
    assert history["total"] >= 1
    assert any(entry["action"] == "create" for entry in history["items"])


def test_import_does_not_touch_the_specification_by_itself(client, headers):
    """Пока строки не перенесли, устройств не прибавляется."""
    before = client.get("/devices", headers=headers["viewer"]).json()["total"]
    upload(client, headers, "устройства.csv", CSV_FILE)
    assert client.get("/devices", headers=headers["viewer"]).json()["total"] == before


def test_rows_can_be_dropped(client, headers):
    upload(client, headers, "устройства.csv", CSV_FILE)
    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    assert client.delete(f"/import/rows/{rows[0]['id']}", headers=headers["editor"]).status_code == 204
    assert len(client.get("/import/rows", headers=headers["viewer"]).json()) == len(rows) - 1

    assert client.delete("/import/rows", headers=headers["editor"]).status_code == 204
    assert client.get("/import/rows", headers=headers["viewer"]).json() == []


def test_xlsx_is_read(client, headers):
    """Excel приносят чаще, чем csv."""
    openpyxl = pytest.importorskip("openpyxl")
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.append(["Название", "Модель", "IP"])
    sheet.append(["Станок из Excel", "Тестовый коммутатор", "10.10.2.5"])
    buffer = io.BytesIO()
    book.save(buffer)

    response = upload(client, headers, "устройства.xlsx", buffer.getvalue())
    assert response.status_code == 201, response.text[:200]
    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    assert rows[0]["name"] == "Станок из Excel"
    assert rows[0]["management_ip"] == "10.10.2.5"


def test_windows_encoding_is_understood(client, headers):
    """Excel на русской локали сохраняет csv в cp1251."""
    content = "Имя;Модель\nСтанок в кодировке;Тестовый\n".encode("cp1251")
    assert upload(client, headers, "устройства.csv", content).status_code == 201
    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    assert rows[0]["name"] == "Станок в кодировке"


def test_unreadable_file_is_refused_clearly(client, headers):
    response = upload(client, headers, "картинка.png", b"\x89PNG\r\n\x1a\n musor")
    assert response.status_code == 400
    assert "xlsx" in response.json()["detail"]


def test_viewer_cannot_import(client, headers):
    response = client.post(
        "/import/devices",
        files={"file": ("у.csv", CSV_FILE, "text/csv")},
        headers=headers["viewer"],
    )
    assert response.status_code == 403
