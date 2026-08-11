"""Разбор выгрузки Siemens Automation Tool (.xml).

Инструмент Siemens сканирует сеть PROFINET и выгружает всё, что нашёл:
станции с их IP и MAC, артикулы, серийные номера, версии прошивок и состав
стоек по слотам. Для завода это готовая спецификация — переписывать сотню
станций руками, когда они уже выгружены, незачем.

Что где лежит:

    <Devices>
      <Device DeviceType="CPU 1512SP-1 PN" IPAddress="…" ProfinetName="mill2">
        <LocalModules>
          <Module Slot="1" DeviceType="DI 16x24VDC ST" … />
        </LocalModules>
        <DistributedIO>
          <Interface Name="PROFINET IO-System : PN/IE_2">
            <RemoteDevice … />          ведомые этой шины
          </Interface>
        </DistributedIO>
      </Device>
    </Devices>

Ведомые почти всегда перечислены и наверху, отдельными станциями: в
присланных файлах так совпали 12 из 16. Заводить их вторым рядом нельзя —
получится сотня двойников. Поэтому строка на станцию всё равно одна, а
принадлежность к шине и её ведущему дописывается ей в примечание. Ведомые,
которых наверху нет (их бывает не видно по сети — например за шлюзом), в
строки всё-таки попадают: потерять железку хуже, чем показать лишнюю.

Модули в строки не превращаются намеренно. Модуль ввода-вывода — не
сетевой порт: у DI 16x24VDC нет ни разъёма, ни кабеля, и место ему в
описании станции, а не в списке портов. Состав стойки уходит в примечание
одной строкой «слот 1: …; слот 2: …».
"""

import re
import xml.etree.ElementTree as ET
from typing import Any


def looks_like_siemens(content: bytes) -> bool:
    """Похоже ли на выгрузку. Проверяется до разбора, чтобы на чужом XML
    сказать «не тот формат», а не вывалить ошибку разбора."""
    # Automation Tool сохраняет с меткой порядка байтов — она идёт до
    # объявления XML, и без её отбрасывания файл «не похож на XML».
    head = content[:4096].lstrip(b"\xef\xbb\xbf").lstrip()
    return head.startswith(b"<?xml") or head.startswith(b"<Devices")


def parse_devices(content: bytes, decode) -> list[dict[str, Any]]:
    """Разобрать выгрузку. Возвращает по словарю на станцию: `values` —
    известные поля, `extra` — всё остальное.

    `decode` передаётся снаружи, чтобы кодировку файла определяли в одном
    месте на все форматы.
    """
    root = _read(decode(content))
    stations = root.findall("Device")
    if not stations:
        raise ValueError("В файле нет ни одной станции — это выгрузка Siemens Automation Tool?")

    rows: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    for station in stations:
        row = _station_row(station)
        rows.append(row)
        key = _key(station)
        if key:
            by_key.setdefault(key, row)

    # Ведомые: своим владельцем и шиной дополняют уже найденную станцию, а
    # если такой станции нет — становятся отдельной строкой.
    for station in stations:
        owner = _name(station)
        for interface in station.iterfind("DistributedIO/Interface"):
            bus = (interface.get("Name") or "").strip()
            for remote in interface.findall("RemoteDevice"):
                note = {}
                if bus:
                    note["Шина PROFINET"] = bus
                if owner:
                    note["Ведущий"] = owner
                key = _key(remote)
                known = by_key.get(key) if key else None
                if known is not None:
                    known["extra"].update(note)
                    continue
                row = _station_row(remote)
                row["extra"].update(note)
                rows.append(row)
                if key:
                    by_key.setdefault(key, row)

    return rows


def _read(text: str) -> ET.Element:
    try:
        return ET.fromstring(_clean(text))
    except ET.ParseError as exc:
        raise ValueError(f"Не удалось разобрать XML: {exc}") from None


# Символы, которые XML запрещает вовсе. Automation Tool всё равно их пишет —
# в присланных файлах шесть версий прошивок начинались с `&#x0;`, и на них
# спотыкался любой разборщик. Выбрасываем, а не падаем: из-за нулевого байта
# в номере версии терять всю выгрузку глупо.
_REFERENCE = re.compile(r"&#x([0-9A-Fa-f]+);|&#([0-9]+);")
_ALLOWED_CONTROL = {0x09, 0x0A, 0x0D}


def _clean(text: str) -> str:
    def drop(match: re.Match[str]) -> str:
        code = int(match.group(1), 16) if match.group(1) else int(match.group(2))
        forbidden = code < 0x20 and code not in _ALLOWED_CONTROL
        return "" if forbidden else match.group(0)

    text = _REFERENCE.sub(drop, text)
    return "".join(ch for ch in text if ord(ch) >= 0x20 or ord(ch) in _ALLOWED_CONTROL)


def _station_row(node: ET.Element) -> dict[str, Any]:
    """Станция → поля строки импорта."""
    extra: dict[str, Any] = {}
    for title, attribute in (
        ("MAC", "MACAddress"),
        ("Артикул", "ArticleNumber"),
        ("Серийный номер", "SerialNumber"),
        ("Прошивка", "FirmwareVersion"),
        ("Маска", "Subnet"),
        ("Шлюз", "Gateway"),
    ):
        value = (node.get(attribute) or "").strip()
        if value:
            extra[title] = value

    # Имя станции в сети и её обозначение в проекте расходятся: у одной
    # железки бывает «S7-1500» в обозначении и «mill2» в сети. Обозначение
    # сохраняем, когда оно добавляет что-то к имени.
    label = (node.get("Device") or "").strip()
    name = _name(node)
    if label and label != name:
        extra["Обозначение"] = label

    modules = _modules(node)
    if modules:
        extra["Модули"] = modules

    return {
        "values": {
            "name": name,
            # Тип из выгрузки — это ровно модель железки («CPU 1512SP-1 PN»,
            # «IM 155-6 PN ST»), то есть шаблон устройства. У части станций
            # он пуст — тогда годится обозначение: «BLADE IO System» ближе к
            # модели, чем пустота.
            "template_name": (node.get("DeviceType") or "").strip() or label,
            "management_ip": (node.get("IPAddress") or "").strip(),
        },
        "extra": extra,
    }


def _modules(node: ET.Element) -> str:
    """Состав стойки одной строкой. У станции модули лежат в `LocalModules`,
    у ведомой — прямо в ней самой."""
    found = node.findall("LocalModules/Module") or node.findall("Module")
    parts = []
    for module in found:
        title = (module.get("DeviceType") or module.get("Device") or "").strip()
        if not title:
            continue
        slot = (module.get("Slot") or "").strip()
        parts.append(f"слот {slot}: {title}" if slot else title)
    return "; ".join(parts)


def _name(node: ET.Element) -> str:
    """Имя станции. Берётся сетевое имя, а не `ProfinetConvertedName`:
    последнее — служебная запись Siemens со своими подстановками
    (`xb` вместо подчёркивания и контрольная сумма в хвосте), и читать её
    человеку незачем."""
    return _readable((node.get("ProfinetName") or "").strip()
                     or (node.get("Device") or "").strip())


def _readable(name: str) -> str:
    """Кириллица, записанная как `xn--j1ajdcc3d`, — обратно в «спрыск».

    Имя PROFINET допускает только латиницу, поэтому русские названия
    станций живут в сети в виде punycode, и часть железок так себя и
    называет. Это не догадка о содержимом, а обратимое преобразование той
    же строки: без него в спецификацию попадает десяток названий, по
    которым ничего не найти.
    """
    if "xn--" not in name.lower():
        return name
    try:
        decoded = name.encode("ascii").decode("idna")
    except (UnicodeError, UnicodeDecodeError):
        # Не всякая строка с `xn--` — настоящий punycode: длинные метки и
        # обрубки не разбираются. Тогда остаётся как есть.
        return name
    return decoded or name


def _key(node: ET.Element) -> str:
    """Чем станция опознаётся как та же самая. Адрес надёжнее имени, MAC
    надёжнее адреса — но у части станций пусто и то и другое."""
    mac = (node.get("MACAddress") or "").strip().upper()
    if mac:
        return f"mac:{mac}"
    ip = (node.get("IPAddress") or "").strip()
    if ip:
        return f"ip:{ip}"
    name = _name(node)
    return f"name:{name.lower()}" if name else ""
