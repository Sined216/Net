"""Опрос устройства по SNMP (/snmp/probe).

Настоящий SNMP-агент в тестах не поднимается — это отдельная страница,
ничем не связанная с остальным приложением, и сеть здесь не тестовая
зависимость, а внешний мир. `snmp_probe.probe` подменяется: проверяется
то, что действительно принадлежит эндпоинту — проверка входных данных,
права и форма ответа, — а не сам протокол (у pysnmp есть свои тесты).
"""

from app import schemas, snmp_probe


def test_viewer_cannot_probe(client, headers):
    response = client.post(
        "/snmp/probe",
        json={"host": "10.0.0.1", "version": "v2c", "community": "public"},
        headers=headers["viewer"],
    )
    assert response.status_code == 403


def test_v2c_without_community_is_rejected(client, headers):
    response = client.post(
        "/snmp/probe", json={"host": "10.0.0.1", "version": "v2c"}, headers=headers["editor"],
    )
    assert response.status_code == 422


def test_v3_authpriv_without_password_is_rejected(client, headers):
    response = client.post(
        "/snmp/probe",
        json={
            "host": "10.0.0.1", "version": "v3", "username": "admin",
            "security_level": "authPriv", "auth_protocol": "SHA", "auth_password": "secretsecret",
            # priv_protocol/priv_password не заданы — authPriv без них бессмыслен
        },
        headers=headers["editor"],
    )
    assert response.status_code == 422


def test_successful_probe_shape(client, headers, monkeypatch):
    async def fake_probe(**kwargs):
        assert kwargs["host"] == "10.0.0.1"
        assert kwargs["version"] == "v2c"
        return snmp_probe.ProbeResult(
            ok=True, elapsed_ms=42,
            trace=[snmp_probe.TraceStep(label="Адрес 10.0.0.1:161", ok=True, detail="транспорт создан", elapsed_ms=1)],
            system=snmp_probe.SystemInfo(sys_name="SW-TEST-01", sys_descr="Test switch"),
            interfaces=[
                snmp_probe.InterfaceInfo(index=1, descr="Gi0/1", oper_status="включён"),
            ],
        )

    monkeypatch.setattr(snmp_probe, "probe", fake_probe)

    response = client.post(
        "/snmp/probe",
        json={"host": "10.0.0.1", "version": "v2c", "community": "public"},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["error"] is None
    assert body["elapsed_ms"] == 42
    assert body["trace"] == [
        {"label": "Адрес 10.0.0.1:161", "ok": True, "detail": "транспорт создан", "elapsed_ms": 1},
    ]
    assert body["system"]["sys_name"] == "SW-TEST-01"
    assert body["interfaces"] == [
        {
            "index": 1, "descr": "Gi0/1", "type_raw": None, "type_label": None,
            "mtu": None, "speed_bps": None, "mac": None,
            "admin_status": None, "oper_status": "включён",
        },
    ]


def test_failed_probe_returns_200_with_ok_false(client, headers, monkeypatch):
    """Отказ устройства ответить — не HTTP-ошибка: ручка всегда 200,
    а причину и диагностический след видно в теле ответа."""
    async def fake_probe(**kwargs):
        return snmp_probe.ProbeResult(
            ok=False, elapsed_ms=8300, error="Устройство не ответило за отведённое время",
            trace=[snmp_probe.TraceStep(label="Адрес 10.0.0.1:161", ok=True, detail="транспорт создан", elapsed_ms=1)],
        )

    monkeypatch.setattr(snmp_probe, "probe", fake_probe)

    response = client.post(
        "/snmp/probe",
        json={"host": "10.0.0.1", "version": "v2c", "community": "public"},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "не ответило" in body["error"]
    assert body["system"] is None
    assert len(body["trace"]) == 1


def test_request_schema_defaults():
    """Порт по умолчанию 161, версия по умолчанию v2c — совпадает с тем,
    что человек ожидает увидеть уже заполненным на форме."""
    payload = schemas.SnmpProbeRequest(host="10.0.0.1", community="public")
    assert payload.port == 161
    assert payload.version == "v2c"
