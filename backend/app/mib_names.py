"""Точные имена SNMP-объектов — через настоящий разбор MIB (pysnmp/pysmi),
а не свой короткий справочник по префиксам. У прежнего ручного варианта
(держался прямо в `snmp_probe.py`) часть имён оказалась неточной —
например, колонка MAC-таблицы моста была подписана «dot1dTpFwdPort», хотя
в настоящем `BRIDGE-MIB` она называется `dot1dTpFdbPort» (Forwarding
Database, не Forward). Отсюда и переход на разбор настоящих MIB-файлов:
ручные подписи легко чуть-чуть разойдутся с реальностью, а MIB — нет.

MIB-модули берутся из пакета `pysnmp-mibs` — компилированные `.py`-файлы
в том же формате, что и MIB, которые идут в комплекте с самим pysnmp
(`SNMPv2-MIB` и десяток служебных), поэтому грузятся тем же `MibBuilder`
без переделок. Загружается один раз при первом обращении и держится в
процессе — сама компиляция быстрая (доли секунды на десяток модулей), а
разбор OID после этого — микросекунды, можно звать хоть на каждый узел
дерева при обходе.

Загружен только тот набор модулей, что реально может встретиться при
опросе управляемого коммутатора без специальных прав (см. `_MODULES`) —
полный `pysnmp-mibs` — больше двух сотен модулей, львиная доля не по делу
и грузить их все незачем. Частные (vendor-specific) ветки производителя в
этот набор заведомо не входят: для них резолвер честно отдаёт «не
распознано», а не гадает.
"""

import os
import threading
import warnings
from typing import Optional

from pysnmp.smi import builder, view

# Модули, которых хватает для всего, что уже читает snmp_probe.py, плюс
# самые ходовые группы верхнего уровня MIB-2 (icmp/egp/snmp) — для полноты
# при «сыром» обходе, где может попасться что угодно из стандартного
# дерева.
_MODULES = (
    "RFC1213-MIB", "SNMPv2-MIB", "IF-MIB", "IP-MIB", "TCP-MIB", "UDP-MIB",
    "BRIDGE-MIB", "Q-BRIDGE-MIB", "P-BRIDGE-MIB",
    "ENTITY-MIB", "HOST-RESOURCES-MIB",
)

# Эти два имени резолвер отдаёт как «ближайшего известного предка», когда
# настоящий OID ему не знаком (частная ветка производителя, нестандартный
# MIB) — SNMPv2-SMI — служебный модуль сам о́н описывает не объекты
# устройства, а точки самого дерева ASN.1 (iso, mib-2, enterprises и
# т. п.). Совпадение с ним не считается успешным разбором.
_GENERIC_MODULE = "SNMPv2-SMI"

# Самые частые номера производителей в частной ветке (enterprises) — не
# реестр IANA целиком, только то, что встречается на практике чаще всего;
# используется только как человекочитаемая подсказка, когда точное имя
# объекта разобрать не удалось.
KNOWN_ENTERPRISES = {
    9: "Cisco", 11: "HP", 311: "Microsoft", 2636: "Juniper",
    8072: "Net-SNMP", 8691: "Moxa", 2021: "UCD-SNMP/Net-SNMP",
}

_lock = threading.Lock()
_view: Optional[view.MibViewController] = None
_unavailable = False


def _get_view() -> Optional[view.MibViewController]:
    global _view, _unavailable
    if _view is not None or _unavailable:
        return _view
    with _lock:
        if _view is not None or _unavailable:
            return _view
        try:
            import pysnmp_mibs
            mib_dir = os.path.dirname(pysnmp_mibs.__file__)
            mib_builder = builder.MibBuilder()
            mib_builder.add_mib_sources(builder.DirMibSource(mib_dir))
            with warnings.catch_warnings():
                # pysnmp-mibs — компилированные MIB-модули под API pysnmp
                # 4.x; сам pysnmp 7.x держит устаревшие алиасы
                # (importSymbols/exportSymbols) ради совместимости, но
                # предупреждает об этом на каждый — для десятка модулей
                # это шум, а не сигнал о настоящей проблеме в этом коде.
                warnings.filterwarnings("ignore", category=DeprecationWarning)
                mib_builder.load_modules(*_MODULES)
            _view = view.MibViewController(mib_builder)
        except Exception:
            # Пакет с MIB недоступен или один из модулей не собрался — не
            # повод ронять опрос: резолвер просто дальше молчит, подписи
            # остаются на резервный (числовой) вариант у вызывающего кода.
            _unavailable = True
            return None
    return _view


def resolve(oid: str) -> Optional[tuple]:
    """`(имя_модуля, символьное_имя, суффикс_как_строка)` для полного
    OID — или `None`, если MIB недоступны, либо разбор довёл только до
    служебной точки дерева ASN.1 (iso/mib-2/enterprises и т. п.), а не до
    настоящего объекта."""
    mib_view = _get_view()
    if mib_view is None:
        return None
    try:
        oid_tuple = tuple(int(p) for p in oid.split("."))
        mod_name, sym_name, suffix = mib_view.get_node_location(oid_tuple)
    except Exception:
        return None
    if str(mod_name) == _GENERIC_MODULE:
        return None
    suffix_text = ".".join(str(s) for s in suffix) if suffix else ""
    return str(mod_name), str(sym_name), suffix_text


def resolve_symbol(oid: str) -> Optional[str]:
    """Голое символьное имя объекта («ifSpeed»), без модуля и суффикса —
    для подписи известных фиксированных OID (системная группа, колонки
    таблиц) взамен собственноручно набранных названий."""
    found = resolve(oid)
    return found[1] if found else None


def resolve_module(oid: str) -> str:
    """Имя модуля MIB для OID, с резервным вариантом на тот случай, если
    точный разбор не удался — по номеру производителя в частной ветке
    (если он входит в `KNOWN_ENTERPRISES`) или просто «неизвестная
    ветка»."""
    found = resolve(oid)
    if found:
        return found[0]
    parts = [int(p) for p in oid.split(".")]
    if len(parts) >= 7 and tuple(parts[:6]) == (1, 3, 6, 1, 4, 1):
        vendor = parts[6]
        vendor_name = KNOWN_ENTERPRISES.get(vendor)
        return f"enterprises ({vendor_name})" if vendor_name else f"enterprises (№{vendor})"
    return "неизвестная ветка"
