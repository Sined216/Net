"""Опрос устройства по SNMP — что оно вообще отдаёт по протоколу.

Страница «SNMP» — отдельный, ничем не связанный с остальным приложением
инструмент: ничего не пишет в базу, не трогает спецификацию оборудования и
не заводит связей. Задача — посмотреть вживую, что такое SNMP, до того как
решать, как его встраивать в документирование сети (см. этап 4 ТЗ,
SNMP/LLDP-опрос — тот раздел ждёт этой ручной проверки как первого шага).

По прямой просьбе «вытащить всё, что можно» опрос читает не только базовые
системную группу и таблицу портов, а всё, что обычно умеет отдавать
управляемый коммутатор без специальных прав:

- системная группа (SNMPv2-MIB::system);
- таблица интерфейсов, база + расширение (IF-MIB::ifTable, ifXTable) —
  имя, псевдоним, точная скорость гигабитных и более быстрых портов;
- IP-адреса на портах (IP-MIB::ipAddrTable);
- ARP-таблица устройства (IP-MIB::ipNetToMediaTable) — какие MAC оно видит
  за какими IP;
- MAC-таблица моста (BRIDGE-MIB::dot1dTpFwdTable) — какие MAC выучены на
  каких портах;
- VLAN каждого порта (Q-BRIDGE-MIB::dot1qPvid) — только базовый untagged/
  access VLAN, разбор списка транковых VLAN сюда не входит.

Последние пять — необязательные: далеко не всякое устройство их
поддерживает (у роутера может не быть Bridge-MIB, у простого свитча —
Q-BRIDGE-MIB), и отказ по ним не считается отказом всего опроса — только
основная системная группа и ifTable обязательны.

Кроме «умного» разбора есть и совсем прямой инструмент — `raw_walk()`:
обход произвольной ветки дерева MIB без разбора по полям, сырые пары
OID=значение, как они есть у устройства, включая собственные (vendor-
specific) ветки производителя. Это отдельное, осознанно медленное
действие с своим пределом на число OID и время — обычный опрос его не
делает.

Версии протокола — все три ходовые: v1, v2c (community-строка, без
шифрования) и v3 (логин/пароль, опционально с шифрованием). У v3 экран не
проверяет самостоятельно, тот ли уровень защиты выбран под введённые
данные, — это делает Pydantic-схема запроса.

Отказ устройства ответить — здесь не исключение, а обычный исход:
`probe()`/`raw_walk()` никогда не бросают исключение наружу, а возвращают
результат с `ok=False` и текстом причины, вместе со следом (`trace`) того,
что успело произойти — вплоть до того, что уже собрано на момент обрыва по
общему таймауту.
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional

import pysnmp.hlapi.v3arch.asyncio as hlapi

# Сколько ждать ответа и сколько раз повторить один запрос. Не настраивается
# с экрана намеренно: большой таймаут на форме — это способ подвесить
# запрос сервера на произвольный срок по чужой воле.
_TIMEOUT_S = 4.0
_RETRIES = 1

# Общий потолок на весь опрос, а не только на отдельный запрос. Таблиц теперь
# опрашивается несколько подряд (порты, IP, ARP, MAC...), и без общего
# предела недоступное или просто «разговорчивое» устройство держало бы
# запрос сервера дольше, чем ждёт прокси перед ним, — человек тогда видит не
# наше понятное сообщение, а сырой «Gateway Time-out» от прокси.
_TOTAL_BUDGET_S = 30.0

# Сколько строк таблицы просить за один запрос при обходе (GETBULK, только
# v2c/v3): без этого — по одному значению на запрос, и таблица портов
# реального коммутатора на полсотни гнёзд превращалась в добрых две сотни
# круговых обменов вместо десятка.
_BULK_MAX_REPETITIONS = 25

# Отдельный, куда более щедрый предел — для «Обойти всё дерево MIB»: это
# осознанно медленное действие по отдельной кнопке, не часть обычного
# опроса.
_RAW_WALK_BUDGET_S = 25.0
_RAW_WALK_MAX_OIDS = 500

# Для «сырого» обхода: к какому модулю MIB относится OID — не полноценный
# разбор через настоящие MIB-файлы (это отдельная тяжёлая зависимость,
# которую весь модуль сознательно обходит — везде lookupMib=False), а
# короткая таблица самых ходовых префиксов дерева. Проверяется по самому
# длинному совпадающему префиксу, поэтому порядок в списке не важен —
# сортируется один раз при загрузке модуля.
_MIB_MODULE_PREFIXES: list = [
    ((1, 3, 6, 1, 2, 1, 1), "SNMPv2-MIB (система)"),
    ((1, 3, 6, 1, 2, 1, 2, 2, 1), "IF-MIB::ifTable (порты)"),
    ((1, 3, 6, 1, 2, 1, 2), "IF-MIB (interfaces)"),
    ((1, 3, 6, 1, 2, 1, 31, 1, 1, 1), "IF-MIB::ifXTable (порты, расширение)"),
    ((1, 3, 6, 1, 2, 1, 31), "IF-MIB"),
    ((1, 3, 6, 1, 2, 1, 3), "IP-MIB::at (устарело)"),
    ((1, 3, 6, 1, 2, 1, 4, 20, 1), "IP-MIB::ipAddrTable (IP-адреса)"),
    ((1, 3, 6, 1, 2, 1, 4, 22, 1), "IP-MIB::ipNetToMediaTable (ARP)"),
    ((1, 3, 6, 1, 2, 1, 4), "IP-MIB"),
    ((1, 3, 6, 1, 2, 1, 5), "ICMP-MIB"),
    ((1, 3, 6, 1, 2, 1, 6), "TCP-MIB"),
    ((1, 3, 6, 1, 2, 1, 7), "UDP-MIB"),
    ((1, 3, 6, 1, 2, 1, 8), "EGP-MIB"),
    ((1, 3, 6, 1, 2, 1, 10), "TRANSMISSION-MIB"),
    ((1, 3, 6, 1, 2, 1, 11), "SNMP-MIB (статистика самого агента)"),
    ((1, 3, 6, 1, 2, 1, 17, 4, 3, 1), "BRIDGE-MIB::dot1dTpFwdTable (MAC-таблица)"),
    ((1, 3, 6, 1, 2, 1, 17, 1, 4, 1), "BRIDGE-MIB::dot1dBasePortTable"),
    ((1, 3, 6, 1, 2, 1, 17, 7), "Q-BRIDGE-MIB (VLAN)"),
    ((1, 3, 6, 1, 2, 1, 17), "BRIDGE-MIB"),
    ((1, 3, 6, 1, 2, 1, 25), "HOST-RESOURCES-MIB"),
    ((1, 3, 6, 1, 2, 1, 47), "ENTITY-MIB"),
    ((1, 3, 6, 1, 2, 1), "MIB-2 (стандартная ветка)"),
    ((1, 3, 6, 1, 6, 3), "SNMP-FRAMEWORK-MIB (служебное — USM, VACM)"),
    ((1, 3, 6, 1, 4, 1), "enterprises (частная ветка производителя)"),
]
_MIB_MODULE_PREFIXES.sort(key=lambda item: -len(item[0]))

# Самые частые номера производителей в частной ветке (enterprises) — не
# реестр IANA целиком, только то, что встречается на практике чаще всего.
_KNOWN_ENTERPRISES = {
    9: "Cisco", 11: "HP", 311: "Microsoft", 2636: "Juniper",
    8072: "Net-SNMP", 8691: "Moxa", 2021: "UCD-SNMP/Net-SNMP",
}

_ENTERPRISES_PREFIX = (1, 3, 6, 1, 4, 1)


def _describe_mib_module(oid_parts: tuple) -> str:
    for prefix, name in _MIB_MODULE_PREFIXES:
        if oid_parts[:len(prefix)] == prefix:
            if prefix == _ENTERPRISES_PREFIX and len(oid_parts) > len(prefix):
                vendor = oid_parts[len(prefix)]
                vendor_name = _KNOWN_ENTERPRISES.get(vendor)
                return f"enterprises ({vendor_name})" if vendor_name else f"enterprises (№{vendor})"
            return name
    return "неизвестная ветка"


_SYSTEM_OIDS = {
    "sys_descr": "1.3.6.1.2.1.1.1.0",
    "sys_object_id": "1.3.6.1.2.1.1.2.0",
    "sys_up_time": "1.3.6.1.2.1.1.3.0",
    "sys_contact": "1.3.6.1.2.1.1.4.0",
    "sys_name": "1.3.6.1.2.1.1.5.0",
    "sys_location": "1.3.6.1.2.1.1.6.0",
}

# Официальные имена переменных из SNMPv2-MIB — для диагностического следа:
# без них строка «получено N из 6» ничего не говорит о том, какие именно
# N и какие именно 6.
_SYSTEM_LABELS = {
    "sys_descr": "sysDescr",
    "sys_object_id": "sysObjectID",
    "sys_up_time": "sysUpTime",
    "sys_contact": "sysContact",
    "sys_name": "sysName",
    "sys_location": "sysLocation",
}

# IF-MIB::ifTable — префикс, за которым у каждой колонки идёт .<индекс порта>.
_IF_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 2, 2, 1)
_IF_COLUMNS = {2: "descr", 3: "type", 4: "mtu", 5: "speed", 6: "mac", 7: "admin_status", 8: "oper_status"}
_IF_COLUMN_LABELS = {
    2: "ifDescr", 3: "ifType", 4: "ifMtu", 5: "ifSpeed",
    6: "ifPhysAddress", 7: "ifAdminStatus", 8: "ifOperStatus",
}

# IF-MIB::ifXTable — расширение ifTable теми же индексами (ifIndex): нормальное
# имя порта, свободное описание и точная скорость для линков быстрее ~4.3
# Гбит/с (ifSpeed — 32-битный счётчик и на них «залипает»).
_IFX_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 31, 1, 1, 1)
_IFX_COLUMNS = {1: "name", 15: "high_speed", 18: "alias"}
_IFX_COLUMN_LABELS = {1: "ifName", 15: "ifHighSpeed", 18: "ifAlias"}

# IP-MIB::ipAddrTable — индекс строки: сам IP-адрес (4 байта октетами).
_IP_ADDR_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 4, 20, 1)
_IP_ADDR_COLUMNS = {2: "if_index", 3: "netmask"}
_IP_ADDR_COLUMN_LABELS = {2: "ipAdEntIfIndex", 3: "ipAdEntNetMask"}

# IP-MIB::ipNetToMediaTable (ARP устройства) — индекс: ifIndex + IP (4 байта).
_ARP_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 4, 22, 1)
_ARP_COLUMNS = {2: "mac", 4: "type"}
_ARP_COLUMN_LABELS = {2: "ipNetToMediaPhysAddress", 4: "ipNetToMediaType"}
_ARP_TYPE_LABELS = {1: "прочее", 2: "недействителен", 3: "динамический", 4: "статический"}

# BRIDGE-MIB::dot1dBasePortTable — соответствие номера порта моста и ifIndex:
# на многих устройствах они совпадают, но не гарантированно, поэтому опрашиваем
# отдельно, а не полагаемся на совпадение молча.
_BRIDGE_PORT_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 17, 1, 4, 1)
_BRIDGE_PORT_COLUMNS = {2: "if_index"}
_BRIDGE_PORT_COLUMN_LABELS = {2: "dot1dBasePortIfIndex"}

# BRIDGE-MIB::dot1dTpFwdTable — MAC-таблица моста, индекс: сам MAC (6 байт).
_FWD_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 17, 4, 3, 1)
_FWD_COLUMNS = {2: "port", 3: "status"}
_FWD_COLUMN_LABELS = {2: "dot1dTpFwdPort", 3: "dot1dTpFwdStatus"}
_FWD_STATUS_LABELS = {1: "прочее", 2: "недействителен", 3: "изучен", 4: "собственный", 5: "управляемый"}

# Q-BRIDGE-MIB::dot1qPvid — VLAN без метки (access/untagged) на порту моста.
# Индекс dot1qPortVlanIndex на подавляющем большинстве устройств совпадает с
# номером порта моста (dot1dBasePort) — тем же, что и в dot1dTpFwdTable.
_PVID_TABLE_PREFIX = (1, 3, 6, 1, 2, 1, 17, 7, 1, 4, 5, 1)
_PVID_COLUMNS = {1: "pvid"}
_PVID_COLUMN_LABELS = {1: "dot1qPvid"}

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
    name: Optional[str] = None
    alias: Optional[str] = None
    type_raw: Optional[int] = None
    type_label: Optional[str] = None
    mtu: Optional[int] = None
    speed_bps: Optional[int] = None
    mac: Optional[str] = None
    admin_status: Optional[str] = None
    oper_status: Optional[str] = None
    vlan: Optional[int] = None


@dataclass
class IpAddressInfo:
    address: str
    netmask: Optional[str] = None
    if_index: Optional[int] = None
    if_descr: Optional[str] = None


@dataclass
class ArpEntry:
    ip: str
    mac: Optional[str] = None
    if_index: Optional[int] = None
    if_descr: Optional[str] = None
    type_label: Optional[str] = None


@dataclass
class MacEntry:
    mac: str
    if_index: Optional[int] = None
    if_descr: Optional[str] = None
    status_label: Optional[str] = None


@dataclass
class TraceStep:
    """Один шаг опроса — как он выглядит на странице: что делали, сколько
    ждали, чем кончилось."""
    label: str
    ok: bool
    detail: str
    elapsed_ms: int


@dataclass
class ProbeResult:
    ok: bool
    elapsed_ms: int
    error: Optional[str] = None
    trace: list = field(default_factory=list)
    system: Optional[SystemInfo] = None
    interfaces: list = field(default_factory=list)
    ip_addresses: list = field(default_factory=list)
    arp_entries: list = field(default_factory=list)
    mac_table: list = field(default_factory=list)


@dataclass
class RawOid:
    oid: str
    module: str
    type: str
    value: str


@dataclass
class WalkResult:
    ok: bool
    elapsed_ms: int
    error: Optional[str] = None
    trace: list = field(default_factory=list)
    oids: list = field(default_factory=list)
    truncated: bool = False


def _step(start: float, ok: bool, label: str, detail: str) -> TraceStep:
    return TraceStep(label=label, ok=ok, detail=detail, elapsed_ms=int((time.monotonic() - start) * 1000))


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


def _preview_value(value, limit: int = 60) -> str:
    """Короткое текстовое представление значения для следа — не разбор по
    полям (это отдельно делают функции ниже), а просто «что реально
    пришло», как оно есть."""
    text = value.prettyPrint()
    if len(text) > limit:
        text = text[:limit] + "…"
    return text


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


def _describe_error(err_ind, err_status, err_index, var_binds) -> Optional[str]:
    if err_ind:
        return _translate_error_indication(str(err_ind))
    if err_status:
        at = var_binds[int(err_index) - 1][0] if var_binds and err_index else "?"
        return f"Устройство отбило запрос: {err_status.prettyPrint()} ({at})"
    return None


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
    # trace и result заводятся здесь, а не внутри _run, и наполняются им по
    # ссылке: при обрыве по общему таймауту корутина _run отменяется и не
    # успевает ничего вернуть, а то, что уже записано в trace/result к этому
    # моменту (например, системная группа и порты уже получены, а до
    # MAC-таблицы дело не дошло), остаётся видно — вместо пустого результата.
    trace: list = []
    result = ProbeResult(ok=False, elapsed_ms=0, trace=trace)
    try:
        error = await asyncio.wait_for(
            _run(
                host, port, version, community, username, security_level,
                auth_protocol, auth_password, priv_protocol, priv_password,
                trace, result,
            ),
            timeout=_TOTAL_BUDGET_S,
        )
    except TimeoutError:
        result.elapsed_ms = int((time.monotonic() - started) * 1000)
        trace.append(TraceStep(
            label="Общий предел времени", ok=False,
            detail=f"опрос прерван — не уложился в {int(_TOTAL_BUDGET_S)} с",
            elapsed_ms=result.elapsed_ms,
        ))
        result.error = (
            f"Опрос не уложился в {int(_TOTAL_BUDGET_S)} секунд — устройство отвечает "
            "слишком медленно или данных (например, MAC-адресов) слишком много для такого "
            "срока. Ниже видно, что успели собрать до обрыва."
        )
        result.ok = False
        return result

    result.elapsed_ms = int((time.monotonic() - started) * 1000)
    result.error = error
    result.ok = error is None
    return result


async def _run(
    host: str, port: int, version: str,
    community: Optional[str], username: Optional[str], security_level: str,
    auth_protocol: Optional[str], auth_password: Optional[str],
    priv_protocol: Optional[str], priv_password: Optional[str],
    trace: list, result: ProbeResult,
) -> Optional[str]:
    engine = hlapi.SnmpEngine()
    try:
        t0 = time.monotonic()
        try:
            target = await hlapi.UdpTransportTarget.create((host, port), timeout=_TIMEOUT_S, retries=_RETRIES)
        except Exception as exc:
            msg = f"Не удалось обратиться по адресу «{host}:{port}»: {exc}"
            trace.append(_step(t0, False, f"Адрес {host}:{port}", msg))
            return msg
        trace.append(_step(
            t0, True, f"Адрес {host}:{port}",
            f"транспорт создан, до {_RETRIES + 1} попыт{'ки' if _RETRIES == 0 else 'ок'} по {_TIMEOUT_S:g} с",
        ))

        auth = _build_auth_data(
            version, community, username, security_level,
            auth_protocol, auth_password, priv_protocol, priv_password,
        )

        # --- обязательное: без этого показывать нечего --------------------
        system, sys_error = await _fetch_system(engine, auth, target, trace)
        if sys_error:
            return sys_error
        result.system = system

        if_by_index, if_error = await _fetch_interfaces(engine, auth, target, trace, version)
        if if_error:
            return if_error

        # --- необязательное: устройство может не поддерживать эти MIB, и   -
        # --- это не отказ всего опроса, а просто пустой раздел ------------
        ifx_by_index, _ = await _walk_table(
            engine, auth, target, trace, version,
            label="Расширенные атрибуты портов (ifXTable)",
            root=_IFX_TABLE_PREFIX, columns=_IFX_COLUMNS, column_labels=_IFX_COLUMN_LABELS,
        )
        port_by_bridge, _ = await _walk_table(
            engine, auth, target, trace, version,
            label="Соответствие портов моста (dot1dBasePortTable)",
            root=_BRIDGE_PORT_TABLE_PREFIX, columns=_BRIDGE_PORT_COLUMNS, column_labels=_BRIDGE_PORT_COLUMN_LABELS,
        )
        pvid_by_index, _ = await _walk_table(
            engine, auth, target, trace, version,
            label="VLAN на портах (dot1qPvid)",
            root=_PVID_TABLE_PREFIX, columns=_PVID_COLUMNS, column_labels=_PVID_COLUMN_LABELS,
        )
        _merge_interface_extras(if_by_index, ifx_by_index, port_by_bridge, pvid_by_index)
        result.interfaces = _build_interfaces(if_by_index)
        if_descr_by_index = {
            iface.index: (iface.name or iface.descr or f"ifIndex {iface.index}")
            for iface in result.interfaces
        }

        ip_by_index, _ = await _walk_table(
            engine, auth, target, trace, version,
            label="IP-адреса (ipAddrTable)",
            root=_IP_ADDR_TABLE_PREFIX, columns=_IP_ADDR_COLUMNS, column_labels=_IP_ADDR_COLUMN_LABELS,
        )
        result.ip_addresses = _build_ip_addresses(ip_by_index, if_descr_by_index)

        arp_by_index, _ = await _walk_table(
            engine, auth, target, trace, version,
            label="ARP-таблица (ipNetToMediaTable)",
            root=_ARP_TABLE_PREFIX, columns=_ARP_COLUMNS, column_labels=_ARP_COLUMN_LABELS,
        )
        result.arp_entries = _build_arp_entries(arp_by_index, if_descr_by_index)

        # MAC-таблица моста — потенциально самая большая (на активном
        # коммутаторе — сотни выученных адресов), поэтому идёт последней:
        # если общий бюджет времени исчерпается, всё остальное уже собрано.
        fwd_by_index, _ = await _walk_table(
            engine, auth, target, trace, version,
            label="MAC-таблица (dot1dTpFwdTable)",
            root=_FWD_TABLE_PREFIX, columns=_FWD_COLUMNS, column_labels=_FWD_COLUMN_LABELS,
        )
        result.mac_table = _build_mac_table(fwd_by_index, port_by_bridge, if_descr_by_index)

        return None
    finally:
        # Иначе сокет на каждый опрос остаётся висеть до перезапуска
        # процесса — страница ведь для повторных нажатий, а не одного раза.
        engine.close_dispatcher()


async def _fetch_system(engine, auth, target, trace) -> tuple:
    t0 = time.monotonic()
    var_binds_in = [hlapi.ObjectType(hlapi.ObjectIdentity(oid)) for oid in _SYSTEM_OIDS.values()]
    err_ind, err_status, err_index, var_binds = await hlapi.get_cmd(
        engine, auth, target, hlapi.ContextData(), *var_binds_in, lookupMib=False,
    )
    error = _describe_error(err_ind, err_status, err_index, var_binds)
    if error:
        trace.append(_step(t0, False, "Системная группа (GET)", error))
        return None, error

    values: dict = {}
    got = 0
    lines = []
    for field_name, (_, value) in zip(_SYSTEM_OIDS.keys(), var_binds):
        v = None if _is_missing(value) else value
        values[field_name] = v
        got += v is not None
        oid = _SYSTEM_OIDS[field_name]
        label = _SYSTEM_LABELS[field_name]
        preview = "пусто" if v is None else _preview_value(v)
        lines.append(f"{label} ({oid}) = {preview}")
    trace.append(_step(
        t0, True, "Системная группа (GET)",
        f"один пакет, получено {got} из {len(_SYSTEM_OIDS)} значений:\n" + "\n".join(lines),
    ))

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
    return system, None


async def _walk_table(
    engine, auth, target, trace: list, version: str,
    *, label: str, root: tuple, columns: dict, column_labels: dict,
) -> tuple:
    """Общий обход столбцовой SNMP-таблицы — код, который иначе пришлось бы
    повторять для ifTable, ifXTable, ipAddrTable, ipNetToMediaTable,
    dot1dBasePortTable, dot1dTpFwdTable и dot1qPvid по отдельности.

    Возвращает `{индекс_строки: {имя_поля: значение}}`, где индекс_строки —
    кортеж всего, что в OID шло после номера колонки: для таблиц с простым
    целочисленным индексом (ifIndex, номер порта моста) это кортеж из одного
    числа, для ipAddrTable — из четырёх байт IP, для MAC-таблицы — из шести
    байт самого MAC. Так один и тот же обход годится для любой из них — сам
    смысл индекса разбирает вызывающий код.
    """
    prefix_len = len(root)
    root_oid = ".".join(map(str, root))
    root_obj = hlapi.ObjectType(hlapi.ObjectIdentity(root_oid))

    if version == "v1":
        # GETBULK — только v2c/v3; SNMPv1 умеет забирать лишь одно значение
        # за запрос (GETNEXT).
        method = "GETNEXT — по одному значению за запрос"
        walker = hlapi.walk_cmd(
            engine, auth, target, hlapi.ContextData(), root_obj,
            lookupMib=False, lexicographicMode=False,
        )
    else:
        method = f"GETBULK — пачками до {_BULK_MAX_REPETITIONS} значений за запрос"
        walker = hlapi.bulk_walk_cmd(
            engine, auth, target, hlapi.ContextData(), 0, _BULK_MAX_REPETITIONS, root_obj,
            lookupMib=False, lexicographicMode=False,
        )
    trace.append(TraceStep(
        label=f"{label} — начало", ok=True,
        detail=f"корень {root_oid}.*, способ: {method}", elapsed_ms=0,
    ))

    by_index: dict = {}
    packet_no = 0
    step_start = time.monotonic()
    error = None
    async for err_ind, err_status, err_index, var_binds in walker:
        packet_no += 1
        step_error = _describe_error(err_ind, err_status, err_index, var_binds)
        if step_error:
            trace.append(_step(step_start, False, f"{label} — пакет {packet_no}", step_error))
            error = step_error
            break
        if not var_binds:
            continue

        added = 0
        rows_seen: set = set()
        columns_seen: set = set()
        for name, value in var_binds:
            if _is_missing(value):
                continue
            oid_parts = [int(p) for p in str(name).split(".")]
            if len(oid_parts) < prefix_len + 2 or tuple(oid_parts[:prefix_len]) != root:
                continue  # обход вышел за пределы таблицы — соседняя ветка дерева
            column = oid_parts[prefix_len]
            row_index = tuple(oid_parts[prefix_len + 1:])
            field_name = columns.get(column)
            if field_name is None:
                continue  # колонка не входит в то, что нам от этой таблицы нужно
            by_index.setdefault(row_index, {})[field_name] = value
            added += 1
            rows_seen.add(row_index)
            columns_seen.add(column)

        lines = [f"диапазон OID в ответе: {var_binds[0][0]} … {var_binds[-1][0]} ({len(var_binds)} подряд)"]
        lines.append(f"из них в таблице по нужным колонкам — {added}, вне — {len(var_binds) - added}")
        if rows_seen:
            lines.append(f"строк в пакете: {len(rows_seen)}")
        if columns_seen:
            col_names = ", ".join(column_labels[c] for c in sorted(columns_seen))
            lines.append(f"колонки: {col_names}")
        trace.append(_step(step_start, True, f"{label} — пакет {packet_no}", "\n".join(lines)))
        step_start = time.monotonic()

    if error is None:
        trace.append(TraceStep(
            label=f"{label} — конец таблицы", ok=True,
            detail=f"пакетов: {packet_no}, строк собрано: {len(by_index)}", elapsed_ms=0,
        ))

    return by_index, error


async def _fetch_interfaces(engine, auth, target, trace, version) -> tuple:
    by_index, error = await _walk_table(
        engine, auth, target, trace, version,
        label="Обход портов (ifTable)", root=_IF_TABLE_PREFIX,
        columns=_IF_COLUMNS, column_labels=_IF_COLUMN_LABELS,
    )
    # ifTable индексируется одним числом (ifIndex) — распрямляем кортеж (i,)
    # в голый int, дальше по коду это удобнее.
    return {row_index[0]: row for row_index, row in by_index.items()}, error


def _merge_interface_extras(if_by_index: dict, ifx_by_index: dict, port_by_bridge: dict, pvid_by_index: dict) -> None:
    """Дополняет базовую таблицу портов (ifTable) тем, что нашлось в
    ifXTable (имя, псевдоним, точная скорость) и Q-BRIDGE-MIB (VLAN)."""
    for row_index, row in ifx_by_index.items():
        if_by_index.setdefault(row_index[0], {}).update(row)

    # dot1qPvid индексируется номером порта моста (dot1qPortVlanIndex),
    # который надо сперва перевести в ifIndex через dot1dBasePortTable — на
    # части устройств они совпадают, но полагаться на это молча не стоит.
    for row_index, row in pvid_by_index.items():
        bridge_port = row_index[0]
        bridge_row = port_by_bridge.get((bridge_port,))
        if_index = int(bridge_row["if_index"]) if bridge_row and "if_index" in bridge_row else bridge_port
        if "pvid" in row and if_index in if_by_index:
            if_by_index[if_index]["vlan"] = row["pvid"]


def _build_interfaces(by_index: dict) -> list:
    interfaces = []
    for index in sorted(by_index):
        row = by_index[index]
        iface = InterfaceInfo(index=index)
        if "descr" in row:
            iface.descr = str(row["descr"])
        if "name" in row:
            iface.name = str(row["name"])
        if "alias" in row and str(row["alias"]):
            iface.alias = str(row["alias"])
        if "type" in row:
            type_raw = int(row["type"])
            iface.type_raw = type_raw
            iface.type_label = _TYPE_LABELS.get(type_raw)
        if "mtu" in row:
            iface.mtu = int(row["mtu"])
        speed_bps = int(row["speed"]) if "speed" in row else None
        if "high_speed" in row:
            # ifSpeed — 32-битный счётчик, «залипает» на 4294967295 для
            # линков быстрее ~4.3 Гбит/с; ifHighSpeed (в Мбит/с) точнее для
            # гигабитных и более быстрых портов — предпочитаем его, если он
            # даёт больше.
            high_speed_bps = int(row["high_speed"]) * 1_000_000
            if speed_bps is None or high_speed_bps > speed_bps:
                speed_bps = high_speed_bps
        iface.speed_bps = speed_bps
        if "mac" in row:
            raw = bytes(row["mac"])
            if raw:
                iface.mac = raw.hex(":")
        if "admin_status" in row:
            iface.admin_status = _STATUS_LABELS.get(int(row["admin_status"]), row["admin_status"].prettyPrint())
        if "oper_status" in row:
            iface.oper_status = _STATUS_LABELS.get(int(row["oper_status"]), row["oper_status"].prettyPrint())
        if "vlan" in row:
            iface.vlan = int(row["vlan"])
        interfaces.append(iface)
    return interfaces


def _build_ip_addresses(by_index: dict, if_descr_by_index: dict) -> list:
    out = []
    for row_index, row in sorted(by_index.items()):
        address = ".".join(str(b) for b in row_index)
        if_index = int(row["if_index"]) if "if_index" in row else None
        out.append(IpAddressInfo(
            address=address,
            netmask=row["netmask"].prettyPrint() if "netmask" in row else None,
            if_index=if_index,
            if_descr=if_descr_by_index.get(if_index) if if_index is not None else None,
        ))
    return out


def _build_arp_entries(by_index: dict, if_descr_by_index: dict) -> list:
    out = []
    for row_index, row in sorted(by_index.items()):
        if_index = row_index[0]
        ip = ".".join(str(b) for b in row_index[1:])
        mac = None
        if "mac" in row:
            raw = bytes(row["mac"])
            if raw:
                mac = raw.hex(":")
        type_raw = int(row["type"]) if "type" in row else None
        out.append(ArpEntry(
            ip=ip, mac=mac, if_index=if_index,
            if_descr=if_descr_by_index.get(if_index),
            type_label=_ARP_TYPE_LABELS.get(type_raw) if type_raw is not None else None,
        ))
    return out


def _build_mac_table(by_index: dict, port_by_bridge: dict, if_descr_by_index: dict) -> list:
    out = []
    for row_index, row in sorted(by_index.items()):
        mac = bytes(row_index).hex(":") if len(row_index) == 6 else ".".join(str(b) for b in row_index)
        bridge_port = int(row["port"]) if "port" in row else None
        if_index = None
        if bridge_port is not None:
            bridge_row = port_by_bridge.get((bridge_port,))
            # Соответствие через dot1dBasePortTable, если оно нашлось; если
            # нет — частый на практике случай, когда номер порта моста и
            # есть ifIndex, берём его как есть.
            if_index = int(bridge_row["if_index"]) if bridge_row and "if_index" in bridge_row else bridge_port
        status_raw = int(row["status"]) if "status" in row else None
        out.append(MacEntry(
            mac=mac, if_index=if_index,
            if_descr=if_descr_by_index.get(if_index) if if_index is not None else None,
            status_label=_FWD_STATUS_LABELS.get(status_raw) if status_raw is not None else None,
        ))
    return out


async def raw_walk(
    *, host: str, port: int, version: str,
    community: Optional[str] = None,
    username: Optional[str] = None, security_level: str = "noAuthNoPriv",
    auth_protocol: Optional[str] = None, auth_password: Optional[str] = None,
    priv_protocol: Optional[str] = None, priv_password: Optional[str] = None,
    root_oid: str = "1.3.6.1",
) -> WalkResult:
    """Обход произвольной ветки дерева MIB без разбора по полям — сырые пары
    OID=значение, как их отдаёт устройство, включая собственные ветки
    производителя. Отдельное, осознанно медленное действие: свой предел по
    времени и по числу OID (`_RAW_WALK_MAX_OIDS`) — обычный `probe()` этого
    не делает специально, чтобы не повторить старую находку про случайный
    обход всего дерева устройства вместо одной таблицы."""
    started = time.monotonic()
    trace: list = []
    oids: list = []
    try:
        error, truncated = await asyncio.wait_for(
            _run_raw_walk(
                host, port, version, community, username, security_level,
                auth_protocol, auth_password, priv_protocol, priv_password,
                root_oid, trace, oids,
            ),
            timeout=_RAW_WALK_BUDGET_S,
        )
    except TimeoutError:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        trace.append(TraceStep(
            label="Общий предел времени", ok=False,
            detail=f"обход прерван — не уложился в {int(_RAW_WALK_BUDGET_S)} с, собрано OID: {len(oids)}",
            elapsed_ms=elapsed_ms,
        ))
        return WalkResult(
            ok=False, elapsed_ms=elapsed_ms, trace=trace, oids=oids, truncated=True,
            error=(
                f"Обход не уложился в {int(_RAW_WALK_BUDGET_S)} секунд — показано то, что "
                "успели собрать. Можно продолжить с более узкого корня — тот, на котором "
                "остановились, виден в следе ниже."
            ),
        )

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return WalkResult(ok=error is None, elapsed_ms=elapsed_ms, error=error, trace=trace, oids=oids, truncated=truncated)


async def _run_raw_walk(
    host: str, port: int, version: str,
    community: Optional[str], username: Optional[str], security_level: str,
    auth_protocol: Optional[str], auth_password: Optional[str],
    priv_protocol: Optional[str], priv_password: Optional[str],
    root_oid: str, trace: list, oids: list,
) -> tuple:
    engine = hlapi.SnmpEngine()
    try:
        t0 = time.monotonic()
        try:
            target = await hlapi.UdpTransportTarget.create((host, port), timeout=_TIMEOUT_S, retries=_RETRIES)
        except Exception as exc:
            msg = f"Не удалось обратиться по адресу «{host}:{port}»: {exc}"
            trace.append(_step(t0, False, f"Адрес {host}:{port}", msg))
            return msg, False
        trace.append(_step(
            t0, True, f"Адрес {host}:{port}",
            f"транспорт создан, до {_RETRIES + 1} попыт{'ки' if _RETRIES == 0 else 'ок'} по {_TIMEOUT_S:g} с",
        ))

        auth = _build_auth_data(
            version, community, username, security_level,
            auth_protocol, auth_password, priv_protocol, priv_password,
        )

        try:
            root = hlapi.ObjectType(hlapi.ObjectIdentity(root_oid))
        except Exception as exc:
            msg = f"Не удалось разобрать OID «{root_oid}»: {exc}"
            trace.append(_step(t0, False, "Начальный OID", msg))
            return msg, False

        if version == "v1":
            method = "GETNEXT — по одному значению за запрос"
            walker = hlapi.walk_cmd(engine, auth, target, hlapi.ContextData(), root, lookupMib=False)
        else:
            method = f"GETBULK — пачками до {_BULK_MAX_REPETITIONS} значений за запрос"
            walker = hlapi.bulk_walk_cmd(
                engine, auth, target, hlapi.ContextData(), 0, _BULK_MAX_REPETITIONS, root, lookupMib=False,
            )
        # Здесь НАРОЧНО без lexicographicMode=False — единственное место во
        # всём модуле, где мы действительно хотим идти до конца дерева
        # устройства, а не только заданной ветки: пользователь явно просил
        # «обойти всё». Ограничивают его только предел по числу OID и по
        # времени, а не граница поддерева.
        trace.append(TraceStep(
            label="Обход — начало", ok=True,
            detail=f"корень {root_oid}, способ: {method}, предел: {_RAW_WALK_MAX_OIDS} OID",
            elapsed_ms=0,
        ))

        packet_no = 0
        step_start = time.monotonic()
        error = None
        truncated = False
        async for err_ind, err_status, err_index, var_binds in walker:
            packet_no += 1
            step_error = _describe_error(err_ind, err_status, err_index, var_binds)
            if step_error:
                trace.append(_step(step_start, False, f"Пакет {packet_no}", step_error))
                error = step_error
                break

            for name, value in var_binds:
                if _is_missing(value) or isinstance(value, hlapi.EndOfMibView):
                    continue
                oid_parts = tuple(int(p) for p in str(name).split("."))
                oids.append(RawOid(
                    oid=str(name), module=_describe_mib_module(oid_parts),
                    type=type(value).__name__, value=_preview_value(value, limit=200),
                ))
                if len(oids) >= _RAW_WALK_MAX_OIDS:
                    truncated = True
                    break
            trace.append(_step(
                step_start, True, f"Пакет {packet_no}",
                f"+{len(var_binds)} значений в ответе, всего собрано: {len(oids)}",
            ))
            step_start = time.monotonic()
            if truncated:
                trace.append(TraceStep(
                    label="Предел достигнут", ok=True,
                    detail=f"остановлено на {_RAW_WALK_MAX_OIDS} OID — это сознательное ограничение, "
                           f"устройство может отдавать ещё; последний собранный: {oids[-1].oid}",
                    elapsed_ms=0,
                ))
                break

        if error is None and not truncated:
            trace.append(TraceStep(
                label="Конец дерева MIB", ok=True,
                detail=f"пакетов: {packet_no}, всего OID собрано: {len(oids)}", elapsed_ms=0,
            ))

        return error, truncated
    finally:
        engine.close_dispatcher()
