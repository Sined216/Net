"""Опрос устройства по SNMP (/snmp/probe).

Настоящий SNMP-агент в тестах не поднимается — это отдельная страница,
ничем не связанная с остальным приложением, и сеть здесь не тестовая
зависимость, а внешний мир. `snmp_probe.probe` подменяется: проверяется
то, что действительно принадлежит эндпоинту — проверка входных данных,
права и форма ответа, — а не сам протокол (у pysnmp есть свои тесты).
"""

from app import mib_names, schemas, snmp_probe


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
            "index": 1, "descr": "Gi0/1", "name": None, "alias": None,
            "type_raw": None, "type_label": None,
            "mtu": None, "speed_bps": None, "mac": None,
            "admin_status": None, "oper_status": "включён", "vlan": None,
        },
    ]
    assert body["ip_addresses"] == []
    assert body["arp_entries"] == []
    assert body["mac_table"] == []


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


def test_mib_names_resolve_real_objects():
    """Настоящий разбор MIB — не свой список, поэтому и тест не про то,
    что мы сами когда-то в него вписали, а про то, что резолвер вправду
    узнаёт стандартные объекты."""
    assert mib_names.resolve_symbol("1.3.6.1.2.1.2.2.1.5.1") == "ifSpeed"
    assert mib_names.resolve_symbol("1.3.6.1.2.1.1.5.0") == "sysName"
    # тот самый объект, из-за которого раньше в своём справочнике была
    # ошибка (dot1dTpFwdPort вместо настоящего dot1dTpFdbPort)
    assert mib_names.resolve_symbol("1.3.6.1.2.1.17.4.3.1.2.1.2.3.4.5.6") == "dot1dTpFdbPort"
    assert mib_names.resolve_module("1.3.6.1.2.1.2.2.1.5.1") == "IF-MIB"


def test_mib_names_falls_back_for_unknown_branches():
    # служебная точка дерева ASN.1 (enterprises), а не настоящий объект —
    # разбор не считается успешным
    assert mib_names.resolve("1.3.6.1.4.1.9.1.1") is None
    # но подсказка по известному производителю всё равно есть
    assert mib_names.resolve_module("1.3.6.1.4.1.9.1.1") == "enterprises (Cisco)"
    # неизвестный производитель — номер виден, а не потерян
    assert mib_names.resolve_module("1.3.6.1.4.1.424242.1") == "enterprises (№424242)"
    assert mib_names.resolve_module("1.2.3") == "неизвестная ветка"


def _find_walk_leaf(nodes, oid):
    for n in nodes:
        if n.oid == oid and n.value is not None:
            return n
        found = _find_walk_leaf(n.children, oid)
        if found:
            return found
    return None


def test_build_walk_tree_labels_and_compresses():
    pairs = [
        ("1.3.6.1.2.1.1.5.0", "OctetString", "SW-TEST-01"),
        ("1.3.6.1.2.1.2.2.1.5.1", "Gauge32", "1000000000"),
        ("1.3.6.1.2.1.2.2.1.5.2", "Gauge32", "1000000000"),
    ]
    tree = snmp_probe._build_walk_tree(pairs)

    sys_name = _find_walk_leaf(tree, "1.3.6.1.2.1.1.5.0")
    assert sys_name is not None
    assert sys_name.label == "sysName.0"
    assert sys_name.module == "SNMPv2-MIB"
    assert sys_name.value == "SW-TEST-01"

    if_speed_1 = _find_walk_leaf(tree, "1.3.6.1.2.1.2.2.1.5.1")
    assert if_speed_1 is not None
    assert if_speed_1.label == "ifSpeed.1"
    assert if_speed_1.module == "IF-MIB"

    # общий префикс дерева (mib-2) сжат в один верхний узел, а не
    # развёрнут по одному уровню на каждый компонент OID
    assert len(tree) == 1


def test_request_schema_defaults():
    """Порт по умолчанию 161, версия по умолчанию v2c — совпадает с тем,
    что человек ожидает увидеть уже заполненным на форме."""
    payload = schemas.SnmpProbeRequest(host="10.0.0.1", community="public")
    assert payload.port == 161
    assert payload.version == "v2c"


def test_walk_request_defaults_and_validates_root_oid():
    payload = schemas.SnmpWalkRequest(host="10.0.0.1", community="public")
    assert payload.root_oid == "1.3.6.1"


def test_walk_rejects_malformed_root_oid(client, headers):
    response = client.post(
        "/snmp/walk",
        json={"host": "10.0.0.1", "version": "v2c", "community": "public", "root_oid": "not-an-oid"},
        headers=headers["editor"],
    )
    assert response.status_code == 422


def test_viewer_cannot_walk(client, headers):
    response = client.post(
        "/snmp/walk",
        json={"host": "10.0.0.1", "version": "v2c", "community": "public"},
        headers=headers["viewer"],
    )
    assert response.status_code == 403


def test_successful_walk_shape(client, headers, monkeypatch):
    async def fake_walk(**kwargs):
        assert kwargs["root_oid"] == "1.3.6.1.2.1.1"
        return snmp_probe.WalkResult(
            ok=True, elapsed_ms=17, truncated=False, oid_count=1,
            trace=[snmp_probe.TraceStep(label="Обход — начало", ok=True, detail="корень 1.3.6.1.2.1.1", elapsed_ms=0)],
            tree=[snmp_probe.WalkTreeNode(
                oid="1.3.6.1.2.1.1.5.0", label="sysName.0", module="SNMPv2-MIB",
                type="OctetString", value="SW-TEST-01",
            )],
        )

    monkeypatch.setattr(snmp_probe, "raw_walk", fake_walk)

    response = client.post(
        "/snmp/walk",
        json={"host": "10.0.0.1", "version": "v2c", "community": "public", "root_oid": "1.3.6.1.2.1.1"},
        headers=headers["editor"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["truncated"] is False
    assert body["oid_count"] == 1
    assert body["tree"] == [{
        "oid": "1.3.6.1.2.1.1.5.0", "label": "sysName.0", "module": "SNMPv2-MIB",
        "type": "OctetString", "value": "SW-TEST-01", "children": [],
    }]
