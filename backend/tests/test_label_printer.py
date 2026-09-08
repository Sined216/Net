"""Печать этикетки на Godex G530 (/devices/{id}/print-label) и настройка
адреса принтера (/settings/printer).

Ручку тестируем как SNMP-опрос (test_snmp.py): `label_printer.print_label`
подменяется — проверяется то, что принадлежит эндпоинту (права, откуда
берётся адрес, форма ответа), а не настоящая печать. Саму сборку команды
и поведение при недоступном адресе — отдельно, напрямую по модулю,
локальным TCP-сервером: это не внешняя зависимость, а код в репозитории.
"""

import asyncio

from app import label_printer


# ---------- ручка печати ----------

def test_viewer_cannot_print(client, headers, make_device):
    device = make_device()
    response = client.post(f"/devices/{device['id']}/print-label", headers=headers["viewer"])
    assert response.status_code == 403


def test_print_without_configured_printer_is_422(client, headers, make_device):
    device = make_device()
    response = client.post(f"/devices/{device['id']}/print-label", headers=headers["editor"])
    assert response.status_code == 422
    assert "адрес" in response.json()["detail"].lower()


def test_print_uses_saved_printer_settings(client, headers, make_device, monkeypatch):
    client.patch("/settings/printer", json={"host": "10.10.9.50", "port": 9100}, headers=headers["admin"])
    device = make_device(name="Свитч у окна")

    async def fake_print(**kwargs):
        assert kwargs["host"] == "10.10.9.50"
        assert kwargs["port"] == 9100
        assert kwargs["code"] == device["code"]
        assert kwargs["name"] == "Свитч у окна"
        return label_printer.PrintResult(ok=True, elapsed_ms=12)

    monkeypatch.setattr(label_printer, "print_label", fake_print)

    response = client.post(f"/devices/{device['id']}/print-label", headers=headers["editor"])
    assert response.status_code == 200
    assert response.json() == {"ok": True, "elapsed_ms": 12, "error": None}


def test_print_request_can_override_printer_once(client, headers, make_device, monkeypatch):
    """Адрес в теле запроса используется вместо сохранённого, но не
    заменяет его — следующая печать без тела снова идёт на сохранённый."""
    client.patch("/settings/printer", json={"host": "10.10.9.50"}, headers=headers["admin"])
    device = make_device()

    seen_hosts = []

    async def fake_print(**kwargs):
        seen_hosts.append(kwargs["host"])
        return label_printer.PrintResult(ok=True, elapsed_ms=5)

    monkeypatch.setattr(label_printer, "print_label", fake_print)

    client.post(f"/devices/{device['id']}/print-label", json={"host": "10.10.9.99"}, headers=headers["editor"])
    client.post(f"/devices/{device['id']}/print-label", headers=headers["editor"])
    assert seen_hosts == ["10.10.9.99", "10.10.9.50"]


def test_print_failure_is_200_with_ok_false(client, headers, make_device, monkeypatch):
    """Недоступный принтер — не HTTP-ошибка, тот же принцип, что у SNMP."""
    client.patch("/settings/printer", json={"host": "10.10.9.50"}, headers=headers["admin"])
    device = make_device()

    async def fake_print(**kwargs):
        return label_printer.PrintResult(ok=False, elapsed_ms=4000, error="Принтер не ответил за 10 с.")

    monkeypatch.setattr(label_printer, "print_label", fake_print)

    response = client.post(f"/devices/{device['id']}/print-label", headers=headers["editor"])
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "не ответил" in body["error"]


def test_print_unknown_device_is_404(client, headers):
    client.patch("/settings/printer", json={"host": "10.10.9.50"}, headers=headers["admin"])
    response = client.post("/devices/999999/print-label", headers=headers["editor"])
    assert response.status_code == 404


# ---------- настройки принтера ----------

def test_default_printer_settings(client, headers):
    response = client.get("/settings/printer", headers=headers["viewer"])
    assert response.status_code == 200
    body = response.json()
    assert body["host"] is None
    assert body["port"] == 9100


def test_non_admin_cannot_change_printer_settings(client, headers):
    response = client.patch("/settings/printer", json={"host": "10.10.9.50"}, headers=headers["editor"])
    assert response.status_code == 403


def test_admin_sets_printer_address(client, headers):
    response = client.patch("/settings/printer", json={"host": "10.10.9.50", "port": 9100}, headers=headers["admin"])
    assert response.status_code == 200
    assert response.json()["host"] == "10.10.9.50"

    again = client.get("/settings/printer", headers=headers["viewer"]).json()
    assert again["host"] == "10.10.9.50"


def test_clearing_printer_host_is_explicit(client, headers):
    client.patch("/settings/printer", json={"host": "10.10.9.50"}, headers=headers["admin"])
    cleared = client.patch("/settings/printer", json={"host": None}, headers=headers["admin"])
    assert cleared.status_code == 200
    assert cleared.json()["host"] is None


# ---------- сборка команды и транспорт (напрямую, без HTTP) ----------

def test_build_ezpl_contains_code_and_cyrillic_subtitle():
    command = label_printer.build_ezpl("SW-0042", "Свитч у окна", "Cisco 2960")
    text = command.decode("cp1251")
    assert text.count("SW-0042") == 2  # текстом и в данных QR
    assert "Свитч у окна / Cisco 2960" in text
    assert text.startswith("^Q")
    assert text.rstrip().endswith("E")


def test_build_ezpl_without_name_and_model_skips_subtitle():
    command = label_printer.build_ezpl("SW-0042", None, None)
    text = command.decode("cp1251")
    assert "AB," not in text  # строка подписи не добавляется, если нечего писать


def test_print_label_sends_bytes_to_real_socket():
    """Без pytest-asyncio в проекте — свой цикл через asyncio.run(), как и
    везде, где здесь нужен async вне запроса через TestClient."""
    async def run():
        received = bytearray()

        async def handle(reader, writer):
            received.extend(await reader.read(-1))
            writer.close()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            result = await label_printer.print_label("127.0.0.1", port, "SW-0042")
        return result, received

    result, received = asyncio.run(run())
    assert result.ok is True
    assert result.error is None
    assert b"SW-0042" in received


def test_print_label_refused_connection_is_not_an_exception():
    # Порт 1 — привилегированный и почти наверняка ничего не слушает
    # локально; соединение отклоняется быстро, не по таймауту.
    result = asyncio.run(label_printer.print_label("127.0.0.1", 1, "SW-0042"))
    assert result.ok is False
    assert "не удалось подключиться" in result.error.lower()
