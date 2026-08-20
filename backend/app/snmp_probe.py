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

Отказ устройства ответить — здесь не исключение, а обычный исход: `probe()`
никогда не бросает `ProbeError` наружу, а возвращает `ProbeResult` с
`ok=False` и текстом причины, вместе со следом (`trace`) того, что успело
произойти. Это тот же диагностический след, что виден на самой странице —
разрешён ли адрес, сколько ждали ответ на каждой попытке, на каком шаге всё
остановилось.
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

# Общий потолок на весь опрос, а не только на отдельный запрос. Обход
# таблицы портов — это несколько отдельных запросов, и без общего предела
# недоступное устройство держало бы запрос сервера дольше, чем ждёт прокси
# перед ним, — человек тогда видит не наше понятное сообщение, а сырой
# «Gateway Time-out» от прокси.
_TOTAL_BUDGET_S = 20.0

# Сколько строк таблицы просить за один запрос при обходе (GETBULK, только
# v2c/v3): без этого — по одному значению на запрос, и таблица портов
# реального коммутатора на полсотни гнёзд превращалась в добрых две сотни
# круговых обменов вместо десятка.
_BULK_MAX_REPETITIONS = 25

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
    # Заводится здесь, а не внутри _run: при обрыве по общему таймауту
    # корутина _run отменяется и не успевает ничего вернуть, а список,
    # переданный по ссылке, к этому моменту уже хранит всё, что случилось —
    # его и показываем вместо пустого следа.
    trace: list = []
    try:
        system, interfaces, error = await asyncio.wait_for(
            _run(
                host, port, version, community, username, security_level,
                auth_protocol, auth_password, priv_protocol, priv_password, trace,
            ),
            timeout=_TOTAL_BUDGET_S,
        )
    except TimeoutError:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        trace.append(TraceStep(
            label="Общий предел времени", ok=False,
            detail=f"опрос прерван — не уложился в {int(_TOTAL_BUDGET_S)} с",
            elapsed_ms=elapsed_ms,
        ))
        return ProbeResult(
            ok=False, elapsed_ms=elapsed_ms, trace=trace,
            error=(
                f"Опрос не уложился в {int(_TOTAL_BUDGET_S)} секунд — устройство отвечает "
                "слишком медленно или у него слишком много портов для такого срока. Ниже видно, "
                "на каком шаге всё остановилось."
            ),
        )

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return ProbeResult(
        ok=error is None, elapsed_ms=elapsed_ms, error=error, trace=trace,
        system=system, interfaces=interfaces,
    )


async def _run(
    host: str, port: int, version: str,
    community: Optional[str], username: Optional[str], security_level: str,
    auth_protocol: Optional[str], auth_password: Optional[str],
    priv_protocol: Optional[str], priv_password: Optional[str],
    trace: list,
) -> tuple:
    engine = hlapi.SnmpEngine()
    try:
        t0 = time.monotonic()
        try:
            target = await hlapi.UdpTransportTarget.create((host, port), timeout=_TIMEOUT_S, retries=_RETRIES)
        except Exception as exc:
            msg = f"Не удалось обратиться по адресу «{host}:{port}»: {exc}"
            trace.append(_step(t0, False, f"Адрес {host}:{port}", msg))
            return None, [], msg
        trace.append(_step(
            t0, True, f"Адрес {host}:{port}",
            f"транспорт создан, до {_RETRIES + 1} попыт{'ки' if _RETRIES == 0 else 'ок'} по {_TIMEOUT_S:g} с",
        ))

        auth = _build_auth_data(
            version, community, username, security_level,
            auth_protocol, auth_password, priv_protocol, priv_password,
        )

        system, sys_error = await _fetch_system(engine, auth, target, trace)
        if sys_error:
            return None, [], sys_error

        interfaces, if_error = await _fetch_interfaces(engine, auth, target, trace, version)
        return system, interfaces, if_error
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
    for field_name, (_, value) in zip(_SYSTEM_OIDS.keys(), var_binds):
        v = None if _is_missing(value) else value
        values[field_name] = v
        got += v is not None
    trace.append(_step(t0, True, "Системная группа (GET)", f"получено {got} из {len(_SYSTEM_OIDS)} значений"))

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


async def _fetch_interfaces(engine, auth, target, trace, version) -> tuple:
    by_index: dict[int, dict] = {}
    prefix_len = len(_IF_TABLE_PREFIX)
    root = hlapi.ObjectType(hlapi.ObjectIdentity(".".join(map(str, _IF_TABLE_PREFIX))))

    if version == "v1":
        # GETBULK — только v2c/v3; SNMPv1 умеет забирать лишь одно значение
        # за запрос (GETNEXT).
        walker = hlapi.walk_cmd(
            engine, auth, target, hlapi.ContextData(), root,
            lookupMib=False, lexicographicMode=False,
        )
    else:
        walker = hlapi.bulk_walk_cmd(
            engine, auth, target, hlapi.ContextData(), 0, _BULK_MAX_REPETITIONS, root,
            lookupMib=False, lexicographicMode=False,
        )

    packet_no = 0
    step_start = time.monotonic()
    error = None
    async for err_ind, err_status, err_index, var_binds in walker:
        packet_no += 1
        step_error = _describe_error(err_ind, err_status, err_index, var_binds)
        if step_error:
            trace.append(_step(step_start, False, f"Обход портов — пакет {packet_no}", step_error))
            error = step_error
            break

        added = 0
        for name, value in var_binds:
            if _is_missing(value):
                continue
            oid_parts = [int(p) for p in str(name).split(".")]
            if len(oid_parts) < prefix_len + 2 or tuple(oid_parts[:prefix_len]) != _IF_TABLE_PREFIX:
                continue  # обход вышел за пределы ifTable — соседняя ветка дерева
            column, index = oid_parts[prefix_len], oid_parts[prefix_len + 1]
            field_name = _IF_COLUMNS.get(column)
            if field_name is None:
                continue  # ifIndex (колонка 1) и то, что не входит в перечень, нам отдельно не нужны
            by_index.setdefault(index, {})[field_name] = value
            added += 1
        trace.append(_step(
            step_start, True, f"Обход портов — пакет {packet_no}",
            f"{len(var_binds)} значений в ответе, из них по делу {added}",
        ))
        step_start = time.monotonic()

    if error is None:
        trace.append(TraceStep(
            label="Обход портов — конец таблицы", ok=True,
            detail=f"пакетов: {packet_no}, портов собрано: {len(by_index)}", elapsed_ms=0,
        ))

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
    return interfaces, error
