"""Проверяемые строковые типы для схем API.

Колонки INET/CIDR/MACADDR отвергают мусор сами, но без проверки на входе
пользователь получал бы 500 вместо внятного сообщения о том, какое поле он
заполнил неправильно.

Значения намеренно остаются строками, а не превращаются в `IPv4Address` и
подобное: psycopg2 не умеет адаптировать эти объекты, и каждому месту записи
пришлось бы приводить их обратно. Проверка здесь, хранение — как было.
"""

import ipaddress
import re
from typing import Annotated

from pydantic import AfterValidator, BeforeValidator

_MAC_CLEAN_RE = re.compile(r"[\s:.\-]")
_MAC_HEX_RE = re.compile(r"^[0-9a-f]{12}$")


def _strip(value):
    return value.strip() if isinstance(value, str) else value


def _validate_ip(value: str) -> str:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        raise ValueError(f"«{value}» не похоже на IP-адрес (ожидается, например, 10.10.1.2)") from None
    return value


def _validate_network(value: str) -> str:
    """Приводит запись подсети к адресу сети: 10.10.1.5/24 -> 10.10.1.0/24.

    Так подсеть часто и записывают — «мой адрес и маска», — но тип CIDR в
    PostgreSQL требует нулевых хостовых битов и отверг бы такое значение
    пятисоткой. Нормализованное значение возвращается в ответе, так что
    подмены «втихую» не происходит.
    """
    try:
        return str(ipaddress.ip_network(value, strict=False))
    except ValueError:
        raise ValueError(f"«{value}» не похоже на подсеть (ожидается, например, 10.10.1.0/24)") from None


def _normalize_mac(value):
    """Приводит любую привычную запись MAC к виду aa:bb:cc:dd:ee:ff.

    В жизни один и тот же адрес пишут как AA-BB-CC-DD-EE-FF, aabb.ccdd.eeff
    и AABBCCDDEEFF. Без нормализации поиск по MAC находил бы не всё.
    """
    if not isinstance(value, str):
        return value
    cleaned = _MAC_CLEAN_RE.sub("", value).lower()
    if not _MAC_HEX_RE.match(cleaned):
        raise ValueError(f"«{value}» не похоже на MAC-адрес (ожидается, например, a4:bb:6d:11:22:33)")
    return ":".join(cleaned[i:i + 2] for i in range(0, 12, 2))


IPAddressStr = Annotated[str, BeforeValidator(_strip), AfterValidator(_validate_ip)]
IPNetworkStr = Annotated[str, BeforeValidator(_strip), AfterValidator(_validate_network)]
MacAddressStr = Annotated[str, BeforeValidator(_normalize_mac)]
