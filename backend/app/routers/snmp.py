"""Опрос устройства по SNMP — отдельная страница, см. app/snmp_probe.py.

Ничего не пишет в базу и не привязано к площадке: это диагностический
инструмент, а не часть спецификации оборудования.
"""

from fastapi import APIRouter, Depends, HTTPException

from app import auth, models, schemas, snmp_probe

router = APIRouter(prefix="/snmp", tags=["snmp"])


@router.post("/probe", response_model=schemas.SnmpProbeResult)
async def probe(payload: schemas.SnmpProbeRequest, _: models.User = Depends(auth.can_edit)):
    """Достаёт с устройства системную группу и таблицу интерфейсов.

    Доступ — как у правки (`can_edit`): запрос уходит с сервера в сеть по
    адресу, который вводит человек, и это не праздное любопытство
    смотрящего, а действие, сравнимое с остальными на этом уровне прав.
    """
    try:
        result = await snmp_probe.probe(
            host=payload.host, port=payload.port, version=payload.version,
            community=payload.community,
            username=payload.username, security_level=payload.security_level,
            auth_protocol=payload.auth_protocol, auth_password=payload.auth_password,
            priv_protocol=payload.priv_protocol, priv_password=payload.priv_password,
        )
    except snmp_probe.ProbeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None

    return schemas.SnmpProbeResult(
        elapsed_ms=result.elapsed_ms,
        system=schemas.SnmpSystemInfo(**vars(result.system)),
        interfaces=[schemas.SnmpInterfaceInfo(**vars(iface)) for iface in result.interfaces],
    )
