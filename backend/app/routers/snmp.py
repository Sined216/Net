"""Опрос устройства по SNMP — отдельная страница, см. app/snmp_probe.py.

Ничего не пишет в базу и не привязано к площадке: это диагностический
инструмент, а не часть спецификации оборудования.
"""

from fastapi import APIRouter, Depends

from app import auth, models, schemas, snmp_probe

router = APIRouter(prefix="/snmp", tags=["snmp"])


@router.post("/probe", response_model=schemas.SnmpProbeResult)
async def probe(payload: schemas.SnmpProbeRequest, _: models.User = Depends(auth.can_edit)):
    """Достаёт с устройства всё, что обычно умеет отдавать управляемый
    коммутатор без специальных прав: системную группу, порты (базовые и
    расширенные атрибуты), IP-адреса, ARP- и MAC-таблицы, VLAN на портах.

    Доступ — как у правки (`can_edit`): запрос уходит с сервера в сеть по
    адресу, который вводит человек, и это не праздное любопытство
    смотрящего, а действие, сравнимое с остальными на этом уровне прав.

    Отказ устройства ответить — не HTTP-ошибка: `snmp_probe.probe()` сама
    никогда не бросает исключение на этот счёт, а возвращает `ok=False` с
    текстом причины и диагностическим следом (`trace`). 200 остаётся и для
    удачного, и для неудачного опроса — 5xx здесь означал бы настоящий сбой
    сервера, а не то, что устройство не ответило.
    """
    result = await snmp_probe.probe(
        host=payload.host, port=payload.port, version=payload.version,
        community=payload.community,
        username=payload.username, security_level=payload.security_level,
        auth_protocol=payload.auth_protocol, auth_password=payload.auth_password,
        priv_protocol=payload.priv_protocol, priv_password=payload.priv_password,
    )

    return schemas.SnmpProbeResult(
        ok=result.ok, error=result.error, elapsed_ms=result.elapsed_ms,
        trace=[schemas.SnmpTraceStep(**vars(step)) for step in result.trace],
        system=schemas.SnmpSystemInfo(**vars(result.system)) if result.system else None,
        interfaces=[schemas.SnmpInterfaceInfo(**vars(iface)) for iface in result.interfaces],
        ip_addresses=[schemas.SnmpIpAddress(**vars(a)) for a in result.ip_addresses],
        arp_entries=[schemas.SnmpArpEntry(**vars(a)) for a in result.arp_entries],
        mac_table=[schemas.SnmpMacEntry(**vars(a)) for a in result.mac_table],
    )


@router.post("/walk", response_model=schemas.SnmpWalkResult)
async def walk(payload: schemas.SnmpWalkRequest, _: models.User = Depends(auth.can_edit)):
    """Полный сырой обход дерева MIB от заданного корня — без разбора по
    полям, просто пары OID=значение, как их отдаёт устройство. Отдельное,
    осознанно медленное действие по отдельной кнопке — обычный `/snmp/probe`
    этого не делает (см. docstring `snmp_probe.raw_walk`).
    """
    result = await snmp_probe.raw_walk(
        host=payload.host, port=payload.port, version=payload.version,
        community=payload.community,
        username=payload.username, security_level=payload.security_level,
        auth_protocol=payload.auth_protocol, auth_password=payload.auth_password,
        priv_protocol=payload.priv_protocol, priv_password=payload.priv_password,
        root_oid=payload.root_oid,
    )

    return schemas.SnmpWalkResult(
        ok=result.ok, error=result.error, elapsed_ms=result.elapsed_ms,
        trace=[schemas.SnmpTraceStep(**vars(step)) for step in result.trace],
        oids=[schemas.SnmpRawOid(**vars(o)) for o in result.oids],
        truncated=result.truncated,
    )
