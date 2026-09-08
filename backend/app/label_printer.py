"""Печать этикетки на Godex G530 — тот же принцип, что у SNMP-опроса
(`app/snmp_probe.py`): отказ принтера ответить — не исключение, а обычный
исход. `print_label()` никогда не бросает наружу, всегда возвращает
`PrintResult` с `ok=False` и понятной причиной.

Транспорт — сырой TCP-порт 9100 (JetDirect-подобная печать: соединение,
байты, разрыв, без диалога) — тем же способом, каким говорит с
компьютером большинство этикеточных и чековых принтеров, независимо от
марки.

Команда — EZPL, собственный (EPL-производный) язык Godex: выбран как
родной для этой модели. Если у конкретного экземпляра в меню включён
режим ZPL-II (Zebra-совместимый), собранная здесь команда напечатает
мусор — тогда меняется только `build_ezpl()`, транспорт ниже останется
тем же.

Один встроенный шаблон, без редактора макетов: код устройства крупно, QR
с тем же значением (см. `GET /devices/{id}/qr`), и мельче — название с
моделью, если есть. Разные размеры этикеток, несколько копий, очередь
печати — сознательно не сделаны, это не сюда.

**Точный синтаксис EZPL (размер этикетки под установленный носитель,
команда QR-графики) в этой среде разработки не с чем сверить — ни
принтера, ни доступа к его программной документации здесь нет.** Числа и
команды ниже — по общей структуре языка, а не проверены на живом
устройстве; несовпадение размера и, возможно, синтаксиса QR-команды —
то, что нужно поправить при первом реальном подключении.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Optional

DEFAULT_PORT = 9100

# Соединение — короче, чем у SNMP: печать это одна короткая запись, не
# опрос нескольких таблиц подряд.
_CONNECT_TIMEOUT_S = 4.0
_TOTAL_BUDGET_S = 10.0

# Ролик 40×30 мм при 203 dpi (8 точек/мм) — обычный размер для такого
# класса принтеров. Первое, что стоит поправить под заправленный носитель.
_LABEL_WIDTH_MM = 40
_LABEL_HEIGHT_MM = 30
_DOTS_PER_MM = 8


def _escape(text: str) -> str:
    """В EZPL-строке текстовое поле берётся в кавычки — свои внутри него
    ломают команду, а не текст."""
    return text.replace('"', "'").replace("\n", " ")


def build_ezpl(code: str, name: Optional[str], model: Optional[str]) -> bytes:
    """Собрать команду печати одной этикетки.

    QR несёт то же значение, что и `code` на карточке устройства
    (`GET /devices/{id}/qr`) — этикетка на железке и картинка на экране
    должны совпадать, иначе смысл в них разный.
    """
    width_dots = _LABEL_WIDTH_MM * _DOTS_PER_MM
    lines = [
        f"^Q{_LABEL_HEIGHT_MM},3",  # высота этикетки + зазор между ними, мм
        f"^W{_LABEL_WIDTH_MM}",     # ширина печати, мм
        "^H10",                    # плотность/нагрев печатающей головки
        "^P1",                     # одна копия — редактора числа копий нет
        "^S3",                     # скорость печати
        "^AT",                     # ориентация — верх этикетки к выходу
        "^C1",                     # без обрезки после каждой этикетки
        "^R0",
        "~Q+0",
        "^O0",
        "^D0",
        "^E12",
        "~R255",
        "^L",
        # Код устройства крупно, сверху слева.
        f'AA,24,24,3,1,1,N,"{_escape(code)}"',
        # QR — TODO сверить точный синтаксис команды по руководству
        # программиста Godex EZPL для этой прошивки; здесь — общий вид
        # 2D-штрихкода (позиция, тип, коэффициент увеличения, данные).
        f'B24,100,0,"QR",4,4,M,2,"{_escape(code)}"',
    ]
    subtitle = " / ".join(part for part in (name, model) if part)
    if subtitle:
        lines.append(f'AB,24,{width_dots - 40},1,1,1,N,"{_escape(subtitle)}"')
    lines.append("E")
    # cp1251, не ascii: название и модель обычно по-русски (весь проект
    # русскоязычный), а ascii молча стирал бы кириллицу в вопросительные
    # знаки. cp1251 — самая распространённая кириллическая кодировка у
    # принтеров этого класса, но какую кодовую страницу использует именно
    # эта прошивка — тоже проверяется на месте, не здесь; код устройства
    # (используется и здесь, и в QR) обычно латиница+цифры и от выбора
    # кодировки не зависит.
    return ("\r\n".join(lines) + "\r\n").encode("cp1251", errors="replace")


@dataclass
class PrintResult:
    ok: bool
    elapsed_ms: int
    error: Optional[str] = None


async def print_label(host: str, port: int, code: str,
                       name: Optional[str] = None, model: Optional[str] = None) -> PrintResult:
    started = time.monotonic()
    command = build_ezpl(code, name, model)

    async def _send() -> None:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=_CONNECT_TIMEOUT_S,
        )
        try:
            writer.write(command)
            await writer.drain()
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                # Принтер мог закрыть сокет первым же — уже неважно, байты
                # ушли до этого.
                pass

    try:
        await asyncio.wait_for(_send(), timeout=_TOTAL_BUDGET_S)
        return PrintResult(ok=True, elapsed_ms=int((time.monotonic() - started) * 1000))
    except asyncio.TimeoutError:
        return PrintResult(
            ok=False, elapsed_ms=int((time.monotonic() - started) * 1000),
            error=f"Принтер не ответил за {int(_TOTAL_BUDGET_S)} с — проверьте адрес и что он включён.",
        )
    except OSError as e:
        return PrintResult(
            ok=False, elapsed_ms=int((time.monotonic() - started) * 1000),
            error=f"Не удалось подключиться к принтеру {host}:{port}: {e}.",
        )
