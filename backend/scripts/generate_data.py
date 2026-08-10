"""Наполнение базы для проверки на настоящем объёме.

Целевой объём по ТЗ — тысяча устройств, около двадцати четырёх тысяч портов
и порядка десяти тысяч кабелей. Руками столько не завести, а без них не
проверить ни скорость списка, ни поведение схемы.

Пишет напрямую в базу, минуя API: смысл в объёме, а не в проверке маршрутов,
и пачками это на два порядка быстрее.

    python -m scripts.generate_data --devices 1000 --site 1

Данные помечены: у всех заведённых устройств заметка «нагрузочные данные»,
и снести их можно одним `--clean`.
"""

import argparse
import random
import sys

from sqlalchemy import text

from app.database import SessionLocal
from app import models

MARK = "нагрузочные данные"

MODELS = [
    ("Коммутатор доступа 24 порта", "SW", 24),
    ("Коммутатор доступа 48 портов", "SW", 48),
    ("ЧПУ-стойка", "PLC", 2),
    ("Промышленный ПК", "SRV", 4),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Наполнить базу нагрузочными данными")
    parser.add_argument("--devices", type=int, default=1000)
    parser.add_argument("--site", type=int, default=None, help="id площадки; по умолчанию первая")
    parser.add_argument("--links", type=int, default=None, help="сколько кабелей; по умолчанию треть портов")
    parser.add_argument("--clean", action="store_true", help="удалить ранее сгенерированное и выйти")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        site = db.get(models.Site, args.site) if args.site else db.query(models.Site).order_by(models.Site.id).first()
        if not site:
            print("Нет ни одной площадки — сначала накатите миграции", file=sys.stderr)
            return 1

        if args.clean:
            removed = db.query(models.Device).filter(
                models.Device.site_id == site.id, models.Device.notes == MARK
            ).delete(synchronize_session=False)
            db.commit()
            print(f"Удалено устройств: {removed}")
            return 0

        random.seed(42)  # повторяемость: одна и та же база на каждом прогоне
        templates = _templates(db)
        groups = _groups(db, site.id)

        print(f"Площадка «{site.name}»: завожу устройств — {args.devices}")
        interface_ids = _make_devices(db, site.id, args.devices, templates, groups)
        print(f"Портов создано: {len(interface_ids)}")

        wanted_links = args.links if args.links is not None else len(interface_ids) // 3
        made = _make_links(db, site.id, interface_ids, wanted_links)
        print(f"Кабелей создано: {made}")
        return 0
    finally:
        db.close()


def _templates(db) -> list[models.DeviceTemplate]:
    """Модели техники и их порты. Заводятся один раз и переиспользуются."""
    result = []
    for name, prefix, ports in MODELS:
        template = db.query(models.DeviceTemplate).filter(models.DeviceTemplate.name == name).first()
        if template is None:
            device_type = db.query(models.DeviceType).filter(models.DeviceType.code_prefix == prefix).first()
            if device_type is None:
                device_type = models.DeviceType(name=f"Тип {prefix}", code_prefix=prefix)
                db.add(device_type)
                db.flush()
            template = models.DeviceTemplate(name=name, device_type_id=device_type.id, notes=MARK)
            db.add(template)
            db.flush()
            for number in range(1, ports + 1):
                db.add(models.InterfaceTemplate(
                    template_id=template.id, port_number=number, label=f"Gi0/{number}",
                ))
            db.commit()
        result.append(template)
    return result


def _groups(db, site_id: int) -> list[models.TopologyGroup]:
    groups = []
    for shop in range(1, 6):
        name = f"Цех {shop}"
        group = db.query(models.TopologyGroup).filter(
            models.TopologyGroup.site_id == site_id, models.TopologyGroup.name == name
        ).first()
        if group is None:
            group = models.TopologyGroup(site_id=site_id, name=name, color="#4dabf7")
            db.add(group)
            db.flush()
        groups.append(group)
    db.commit()
    return groups


def _make_devices(db, site_id: int, count: int, templates, groups) -> list[int]:
    """Устройства и их порты — пачками по тысяче строк.

    Коды раздаются подряд от текущего максимума: код уникален на всю
    систему, и наскоро сгенерированные не должны сталкиваться с
    заведёнными руками.
    """
    interface_ids: list[int] = []
    for index in range(count):
        template = templates[index % len(templates)]
        prefix = template.device_type.code_prefix
        code = _next_code(db, prefix)
        device = models.Device(
            site_id=site_id, template_id=template.id, code=code,
            name=f"{template.name} №{index + 1}",
            location=f"Цех {index % 5 + 1}, шкаф {index % 40 + 1}",
            management_ip=f"10.{index // 65025 % 255}.{index // 255 % 255}.{index % 255}",
            notes=MARK,
            topology_group_id=groups[index % len(groups)].id,
        )
        db.add(device)
        db.flush()
        for tpl_iface in template.interfaces:
            iface = models.Interface(
                device_id=device.id, site_id=site_id, port_number=tpl_iface.port_number,
                label=tpl_iface.label, template_interface_id=tpl_iface.id,
            )
            db.add(iface)
            db.flush()
            interface_ids.append(iface.id)
        if index % 100 == 99:
            db.commit()
            print(f"  … {index + 1}")
    db.commit()
    return interface_ids


def _next_code(db, prefix: str) -> str:
    row = db.execute(
        text("""
            INSERT INTO code_sequences (prefix, next_value) VALUES (:prefix, 2)
            ON CONFLICT (prefix) DO UPDATE SET next_value = code_sequences.next_value + 1
            RETURNING next_value
        """),
        {"prefix": prefix},
    ).scalar_one()
    return f"{prefix}-{row - 1:04d}"


def _make_links(db, site_id: int, interface_ids: list[int], wanted: int) -> int:
    """Кабели между случайными свободными портами.

    Порт участвует не более чем в одной связи, поэтому пары берутся из
    перемешанного списка по две подряд — так не приходится ни проверять
    занятость, ни ловить отказы базы.
    """
    pool = interface_ids[:]
    random.shuffle(pool)
    made = 0
    for i in range(0, min(len(pool) - 1, wanted * 2), 2):
        a, b = sorted((pool[i], pool[i + 1]))
        db.add(models.Link(site_id=site_id, interface_a_id=a, interface_b_id=b,
                           source="manual", confirmed=True, notes=MARK))
        made += 1
        if made % 1000 == 0:
            db.commit()
    db.commit()
    return made


if __name__ == "__main__":
    raise SystemExit(main())
