"""Опрос устройства по SNMP — что оно вообще отдаёт по протоколу.

Страница «SNMP» — отдельный, ничем не связанный с остальным приложением
инструмент: ничего не пишет в базу, не трогает спецификацию оборудования и
не заводит связей. Задача — посмотреть вживую, что такое SNMP, до того как
решать, как его встраивать в документирование сети (см. этап 4 ТЗ,
SNMP/LLDP-опрос — тот раздел ждёт этой ручной проверки как первого шага).

Читаются два куска стандартных данных:
- системная группа (SNMPv2-MIB::system) — имя, описание, время работы;
- таблица интерфейсов (IF-MIB::ifTable) — порты со статусом и MAC.

Версии протокола — все три ходовые: v1, v2c (community-строка, без
шифрования) и v3 (логин/пароль, опционально с шифрованием). У v3 экран не
проверяет самостоятельно, тот ли уровень защиты выбран под введённые
данные, — это делает Pydantic-схема запроса.
"""

import time
from dataclasses import dataclass, field
from typing import Optional

import pysnmp.hlapi.v3arch.asyncio as hlapi

# Сколько ждать ответа и сколько раз повторить один запрос. Не настраивается
# с экрана намеренно: большой таймаут на форме — это способ подвесить
# запрос сервера на произвольный срок по чужой воле.
_TIMEOUT_S = 4.0
_RETRIES = 1

_SYSTEM_OIDS = {
    "sys_descr": "1.3.6.1.2.1.1.1.0",
    "sys_object_id": "1.3.6.1.2.1.1.2.0",
    "sys_up_time": "1.3.6.1.2.1.1.3.0",
    "sys_contact": "1.3.6.1.2.1.1.4.0",
    "sys_name": "1.3.6.1.2.1.1.5.0",
    "sys_location": "1.3.6.1.2.1.1.6.0",
}

# IF-MIB::ifTable — префикс, за которым у каждой колонки идёт .<индекс порта>.
_IF_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 2, 2, 1)
_IF_COLUMNS = {2: "descr", 3: "type", 4: "mtu", 5: "speed", 6: "mac", 7: "admin_status", 8: "oper_status"}

_STATUS_LABELS = {
    1: "включён", 2: "выключен", 3: "тест", 4: "неизвестно",
    5: "спит (dormant)", 6: "не установлен", 7: "ждёт нижний уровень",
}

# Самые частые типы интерфейсов на заводском оборудовании — не полный
# перечень IANAifType (там больше двухсот значений), только узнаваемое.
_TYPE_LABELS = {
    1: "прочее", 6: "Ethernet", 24: "loopback", 53: "виртуальный",
    131: "туннель", 135: "802.11 (Wi-Fi)", 161: "агрегированный (LAG)",
}

_AUTH_PROTOCOLS = {
    "MD5": hlapi.usmHMACMD5AuthProtocol,
    "SHA": hlapi.usmHMACSHAAuthProtocol,
    "SHA224": hlapi.usmHMAC128SHA224AuthProtocol,
    "SHA256": hlapi.usmHMAC192SHA256AuthProtocol,
    "SHA384": hlapi.usmHMAC256SHA384AuthProtocol,
    "SHA512": hlapi.usmHMAC384SHA512AuthProtocol,
}
_PRIV_PROTOCOLS = {
    "DES": hlapi.usmDESPrivProtocol,
    "3DES": hlapi.usm3DESEDEPrivProtocol,
    "AES": hlapi.usmAesCfb128Protocol,
    "AES192": hlapi.usmAesCfb192Protocol,
    "AES256": hlapi.usmAesCfb256Protocol,
}


class ProbeError(Exception):
    """Опрос не удался — сообщение уже на русском и годится для показа
    прямо в интерфейсе, без перевода кодов ошибок на стороне фронтенда."""


@dataclass
class SystemInfo:
    sys_descr: Optional[str] = None
    sys_object_id: Optional[str] = None
    sys_up_time_ticks: Optional[int] = None
    sys_up_time_text: Optional[str] = None
    sys_contact: Optional[str] = None
    sys_name: Optional[str] = None
    sys_location: Optional[str] = None


@dataclass
class InterfaceInfo:
    index: int
    descr: Optional[str] = None
    type_raw: Optional[int] = None
    type_label: Optional[str] = None
    mtu: Optional[int] = None
    speed_bps: Optional[int] = None
    mac: Optional[str] = None
    admin_status: Optional[str] = None
    oper_status: Optional[str] = None


@dataclass
class ProbeResult:
    elapsed_ms: int
    system: SystemInfo
    interfaces: list = field(default_factory=list)


def _format_uptime(ticks: int) -> str:
    """TimeTicks — сотые доли секунды с момента включения (RFC 1213)."""
    seconds = ticks // 100
    days, seconds = divmod(seconds, 86400)
    hours, seconds = divmod(seconds, 3600)
    minutes, _ = divmod(seconds, 60)
    parts = []
    if days:
        parts.append(f"{days} дн")
    if hours or days:
        parts.append(f"{hours} ч")
    parts.append(f"{minutes} мин")
    return " ".join(parts)


def _is_missing(value) -> bool:
    """Устройство не реализует эту переменную — это не ошибка запроса,
    ответ просто не про неё (бывает у нестандартных SNMP-агентов)."""
    return isinstance(value, (hlapi.NoSuchObject, hlapi.NoSuchInstance))


def _build_auth_data(
    version: str, community: Optional[str],
    username: Optional[str], security_level: str,
    auth_protocol: Optional[str], auth_password: Optional[str],
    priv_protocol: Optional[str], priv_password: Optional[str],
):
    if version in ("v1", "v2c"):
        return hlapi.CommunityData(community, mpModel=0 if version == "v1" else 1)

    kwargs: dict = {}
    if security_level in ("authNoPriv", "authPriv"):
        kwargs["authKey"] = auth_password
        kwargs["authProtocol"] = _AUTH_PROTOCOLS[auth_protocol]
    if security_level == "authPriv":
        kwargs["privKey"] = priv_password
        kwargs["privProtocol"] = _PRIV_PROTOCOLS[priv_protocol]
    return hlapi.UsmUserData(username, **kwargs)


def _raise_on_error(err_ind, err_status, err_index, var_binds) -> None:
    if err_ind:
        raise ProbeError(_translate_error_indication(str(err_ind)))
    if err_status:
        at = var_binds[int(err_index) - 1][0] if var_binds and err_index else "?"
        raise ProbeError(f"Устройство отбило запрос: {err_status.prettyPrint()} ({at})")


def _translate_error_indication(text: str) -> str:
    """errorIndication у pysnmp — готовый английский текст. Самые частые
    случаи переводятся, остальное показывается как есть — лучше английская
    фраза от библиотеки, чем выдуманная по-русски неточность."""
    known = {
        "No SNMP response received before timeout": (
            "Устройство не ответило за отведённое время — проверьте адрес, "
            "порт, доступность по сети и совпадение community/логина с тем, "
            "что настроено на самом устройстве."
        ),
        "Unsupported SNMP security level": (
            "Устройство не поддерживает выбранный уровень защиты (или "
            "учётная запись SNMPv3 настроена на другой уровень)."
        ),
        "Wrong SNMP PDU digest": "Неверный пароль аутентификации (authKey).",
        "Ciphering services not available": "Шифрование недоступно на сервере — обратитесь к администратору WireMap.",
    }
    return known.get(text, text)


async def probe(
    *, host: str, port: int, version: str,
    community: Optional[str] = None,
    username: Optional[str] = None, security_level: str = "noAuthNoPriv",
    auth_protocol: Optional[str] = None, auth_password: Optional[str] = None,
    priv_protocol: Optional[str] = None, priv_password: Optional[str] = None,
) -> ProbeResult:
    started = time.monotonic()
    engine = hlapi.SnmpEngine()
    try:
        target = await hlapi.UdpTransportTarget.create((host, port), timeout=_TIMEOUT_S, retries=_RETRIES)
    except Exception as exc:
        raise ProbeError(f"Не удалось обратиться по адресу «{host}:{port}»: {exc}") from None

    auth = _build_auth_data(
        version, community, username, security_level,
        auth_protocol, auth_password, priv_protocol, priv_password,
    )

    system = await _fetch_system(engine, auth, target)
    interfaces = await _fetch_interfaces(engine, auth, target)

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return ProbeResult(elapsed_ms=elapsed_ms, system=system, interfaces=interfaces)


async def _fetch_system(engine, auth, target) -> SystemInfo:
    var_binds_in = [hlapi.ObjectType(hlapi.ObjectIdentity(oid)) for oid in _SYSTEM_OIDS.values()]
    err_ind, err_status, err_index, var_binds = await hlapi.get_cmd(
        engine, auth, target, hlapi.ContextData(), *var_binds_in, lookupMib=False,
    )
    _raise_on_error(err_ind, err_status, err_index, var_binds)

    values: dict = {}
    for field_name, (_, value) in zip(_SYSTEM_OIDS.keys(), var_binds):
        values[field_name] = None if _is_missing(value) else value

    system = SystemInfo()
    if values["sys_descr"] is not None:
        system.sys_descr = str(values["sys_descr"])
    if values["sys_object_id"] is not None:
        system.sys_object_id = values["sys_object_id"].prettyPrint()
    if values["sys_up_time"] is not None:
        ticks = int(values["sys_up_time"])
        system.sys_up_time_ticks = ticks
        system.sys_up_time_text = _format_uptime(ticks)
    if values["sys_contact"] is not None:
        system.sys_contact = str(values["sys_contact"])
    if values["sys_name"] is not None:
        system.sys_name = str(values["sys_name"])
    if values["sys_location"] is not None:
        system.sys_location = str(values["sys_location"])
    return system


async def _fetch_interfaces(engine, auth, target) -> list:
    by_index: dict[int, dict] = {}
    prefix_len = len(_IF_TABLE_PREFIX)

    async for err_ind, err_status, err_index, var_binds in hlapi.walk_cmd(
        engine, auth, target, hlapi.ContextData(),
        hlapi.ObjectType(hlapi.ObjectIdentity(".".join(map(str, _IF_TABLE_PREFIX)))),
        lookupMib=False,
    ):
        _raise_on_error(err_ind, err_status, err_index, var_binds)
        for name, value in var_binds:
            if _is_missing(value):
                continue
            oid_parts = [int(p) for p in str(name).split(".")]
            if len(oid_parts) < prefix_len + 2 or tuple(oid_parts[:prefix_len]) != _IF_TABLE_PREFIX:
                continue  # обход вышел за пределы ifTable — WALK дошёл до соседней ветки
            column, index = oid_parts[prefix_len], oid_parts[prefix_len + 1]
            field_name = _IF_COLUMNS.get(column)
            if field_name is None:
                continue  # ifIndex (колонка 1) и колонки за пределами перечня нам не нужны отдельно
            by_index.setdefault(index, {})[field_name] = value

    interfaces = []
    for index in sorted(by_index):
        row = by_index[index]
        iface = InterfaceInfo(index=index)
        if "descr" in row:
            iface.descr = str(row["descr"])
        if "type" in row:
            type_raw = int(row["type"])
            iface.type_raw = type_raw
            iface.type_label = _TYPE_LABELS.get(type_raw)
        if "mtu" in row:
            iface.mtu = int(row["mtu"])
        if "speed" in row:
            iface.speed_bps = int(row["speed"])
        if "mac" in row:
            raw = bytes(row["mac"])
            if raw:
                iface.mac = raw.hex(":")
        if "admin_status" in row:
            iface.admin_status = _STATUS_LABELS.get(int(row["admin_status"]), row["admin_status"].prettyPrint())
        if "oper_status" in row:
            iface.oper_status = _STATUS_LABELS.get(int(row["oper_status"]), row["oper_status"].prettyPrint())
        interfaces.append(iface)
    return interfaces
