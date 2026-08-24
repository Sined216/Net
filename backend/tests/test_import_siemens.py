"""Импорт выгрузки Siemens Automation Tool.

Файл приносят такой, какой его выдал инструмент: с меткой порядка байтов,
запрещёнными в XML символами внутри версий прошивок, кириллическими именами
в виде punycode и ведомыми станциями, которые заодно перечислены наверху
ещё раз. Всё это проверяется здесь: разбор должен пережить каждую из этих
особенностей, потому что чинить выгрузку руками перед загрузкой никто не
станет.
"""

import pytest

from app import importer

BOM = "﻿"

SAMPLE = BOM + """<?xml version="1.0" encoding="UTF-8"?>
<Devices>
  <Device Device="S7-1500" Slot="1" DeviceType="CPU 1512SP-1 PN"
          ArticleNumber="6ES7 512-1DK01-0AB0" SerialNumber="S C-L2CP37722019"
          FirmwareVersion="V02.09.02" Hardware="4" MACAddress="AC:64:17:4C:D8:D4"
          IPAddress="192.168.0.50" Subnet="255.255.255.0" Gateway="192.168.0.110"
          ProfinetName="mill2" ProfinetConvertedName="mill2">
    <DistributedIO>
      <Interface Name="PROFINET IO-System : PN/IE_1">
        <RemoteDevice MACAddress="AC:64:17:61:34:F5" IPAddress="192.168.0.51"
                      Device="mill2_et" DeviceType="IM 155-6 PN ST" Slot="0"
                      ProfinetName="mill2_et" ArticleNumber="" SerialNumber=""
                      FirmwareVersion="" Hardware="2" Subnet="" Gateway="" />
        <RemoteDevice MACAddress="" IPAddress="" Device="Шкаф без адреса" DeviceType=""
                      Slot="0" ProfinetName="" ArticleNumber="CN-8032-L"
                      SerialNumber="" FirmwareVersion="" Hardware="1" Subnet="" Gateway="">
          <Module Device="CT-121F (16DI)" Slot="1" DeviceType="" ArticleNumber=""
                  SerialNumber="" FirmwareVersion="" Hardware="1" />
        </RemoteDevice>
      </Interface>
    </DistributedIO>
  </Device>
  <Device Device="ET200SP" Slot="0" DeviceType="IM 155-6 PN ST" ArticleNumber="6ES7 155"
          SerialNumber="S C-L5DU9738" FirmwareVersion="&#x0;V04.01.00" Hardware="2"
          MACAddress="AC:64:17:61:34:F5" IPAddress="192.168.0.51" Subnet="255.255.255.0"
          Gateway="192.168.0.110" ProfinetName="mill2_et" ProfinetConvertedName="mill2xbet7738">
    <LocalModules>
      <Module Device="DI 16x24VDC ST" Slot="1" DeviceType="DI 16x24VDC ST"
              ArticleNumber="6ES7 131" SerialNumber="S C-L7B10842" FirmwareVersion="" Hardware="2" />
      <Module Device="Server modules" Slot="2" DeviceType="Server modules"
              ArticleNumber="6ES7 193" SerialNumber="S C-L5CV4310" FirmwareVersion="" Hardware="7" />
    </LocalModules>
  </Device>
  <Device Device="BLADE IO System" Slot="" DeviceType="" ArticleNumber="" SerialNumber=""
          FirmwareVersion="" Hardware="0" MACAddress="AC:1D:DF:84:60:EF" IPAddress="192.168.0.108"
          Subnet="255.255.255.0" Gateway="192.168.0.108" ProfinetName="xn--49-1lcl5a"
          ProfinetConvertedName="xn--49-1lcl5a" />
</Devices>
"""


@pytest.fixture
def rows():
    return importer.parse("siemens.xml", SAMPLE.encode("utf-8"))


def by_name(rows, name):
    return next(row for row in rows if row.values["name"] == name)


def test_station_becomes_a_row_with_its_model_and_address(rows):
    """Тип из выгрузки — это модель железки, то есть шаблон устройства."""
    cpu = by_name(rows, "mill2")
    assert cpu.values["template_name"] == "CPU 1512SP-1 PN"
    assert cpu.values["management_ip"] == "192.168.0.50"
    assert cpu.extra["Артикул"] == "6ES7 512-1DK01-0AB0"
    assert cpu.extra["Серийный номер"] == "S C-L2CP37722019"
    # Обозначение в проекте у CPU своё («S7-1500») и имени не повторяет.
    assert cpu.extra["Обозначение"] == "S7-1500"


def test_forbidden_characters_do_not_break_the_file(rows):
    """`&#x0;` в версии прошивки XML запрещает, а инструмент его пишет.

    Из-за одного нулевого байта в номере версии терялась бы вся выгрузка,
    поэтому такие ссылки выбрасываются, а не роняют разбор.
    """
    station = by_name(rows, "mill2_et")
    assert station.extra["Прошивка"] == "V04.01.00"


def test_cyrillic_names_come_back_from_punycode(rows):
    """Имя PROFINET допускает только латиницу, и русские названия живут в
    сети как `xn--…`. В спецификации такое имя бесполезно."""
    assert by_name(rows, "нку49").values["template_name"] == "BLADE IO System"


def test_remote_device_does_not_become_a_second_row(rows):
    """Ведомая станция обычно перечислена и наверху. Второй строкой её
    заводить нельзя — получатся двойники; вместо этого она узнаёт свою шину
    и своего ведущего."""
    same = [row for row in rows if row.values["management_ip"] == "192.168.0.51"]
    assert len(same) == 1, "станция с этим адресом должна быть одна"
    assert same[0].extra["Шина PROFINET"] == "PROFINET IO-System : PN/IE_1"
    assert same[0].extra["Ведущий"] == "mill2"


def test_remote_device_without_a_twin_is_not_lost(rows):
    """А ведомую, которой наверху нет, потерять нельзя: показать лишнюю
    строку не так плохо, как забыть железку."""
    orphan = by_name(rows, "Шкаф без адреса")
    assert orphan.values["management_ip"] == ""
    assert orphan.extra["Ведущий"] == "mill2"
    assert orphan.extra["Модули"] == "слот 1: CT-121F (16DI)"


def test_rack_contents_go_to_the_note(rows):
    """Модуль ввода-вывода — не сетевой порт, и в порты он не превращается.
    Но состав стойки — это то, по чему железку опознают."""
    station = by_name(rows, "mill2_et")
    assert station.extra["Модули"] == "слот 1: DI 16x24VDC ST; слот 2: Server modules"


def test_broken_xml_is_refused_with_a_readable_message():
    with pytest.raises(importer.ImportError_) as caught:
        importer.parse("файл.xml", b"<Devices><Device")
    assert "XML" in str(caught.value)


def test_foreign_xml_is_refused():
    """Чужой XML не должен разбираться наполовину."""
    with pytest.raises(importer.ImportError_) as caught:
        importer.parse("чужое.xml", b"<?xml version='1.0'?><Catalog><Item/></Catalog>")
    assert "станц" in str(caught.value).lower()


def test_upload_through_the_api(client, headers):
    """Тот же файл через маршрут загрузки: строки должны доехать до
    таблицы импорта."""
    response = client.post(
        "/import/devices",
        files={"file": ("siemens.xml", SAMPLE.encode("utf-8"), "text/xml")},
        headers=headers["editor"],
    )
    assert response.status_code == 201, response.text
    assert response.json()["added"] == 4

    rows = client.get("/import/rows", headers=headers["viewer"]).json()
    assert {row["name"] for row in rows} >= {"mill2", "mill2_et", "нку49"}
    cpu = next(row for row in rows if row["name"] == "mill2")
    assert cpu["template_name"] == "CPU 1512SP-1 PN"
    assert cpu["extra"]["Артикул"] == "6ES7 512-1DK01-0AB0"
