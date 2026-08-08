"""Структура базы данных — как она есть на самом деле.

Читается интроспекцией живой базы, а не из моделей и не из schema.sql:
показывать нужно то, что реально лежит на диске, иначе смысл теряется — как
раз расхождение моделей с schema.sql и было одной из найденных проблем.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app import schemas
from app.database import get_db

router = APIRouter(tags=["schema"])

# Пояснения к таблицам: без них список колонок мало что говорит человеку,
# который видит базу впервые.
TABLE_NOTES = {
    "device_types": "Категории устройств. Префикс задаёт вид кода: SW-0001, SRV-0002.",
    "device_templates": "Модели техники. Здесь же цвет узла на схеме и признак съёмных портов.",
    "device_template_interfaces": "Порты модели. Копируются устройству при заведении и правятся только тут.",
    "devices": "Устройства в спецификации — экземпляры моделей. Код генерируется автоматически.",
    "interfaces": "Порты конкретного устройства. Уникален номер порта, название — просто подпись.",
    "links": "Кабели между портами. Конец может пустовать — «подвешен», если порт сняли.",
    "link_templates": "Пресеты кабеля: среда, категория, цвет и стиль линии на схеме.",
    "tags": "Вложенные теги для группировки устройств. У устройства их может быть несколько.",
    "device_tags": "Связка устройств и тегов, многие-ко-многим.",
    "topology_groups": "Рамки на схеме. Ровно одна группа на устройство — в отличие от тегов.",
    "vlans": "Справочник VLAN.",
    "users": "Учётные записи. Удаления нет — только блокировка, чтобы журнал не терял автора.",
    "audit_log": "Журнал изменений: кто, что и когда менял.",
    "code_sequences": "Счётчики кодов устройств, по одному на префикс.",
    "alembic_version": "Служебная: какая миграция применена к этой базе.",
}


@router.get("/schema", response_model=schemas.DatabaseSchema)
def database_schema(db: Session = Depends(get_db)):
    inspector = inspect(db.get_bind())
    tables = []

    for name in sorted(inspector.get_table_names()):
        primary_key = set(inspector.get_pk_constraint(name).get("constrained_columns") or [])

        # Внешние ключи: колонка -> «таблица.колонка», чтобы показать их
        # прямо в строке колонки, а не отдельным малопонятным списком.
        references = {}
        for fk in inspector.get_foreign_keys(name):
            target = fk["referred_table"]
            for local, remote in zip(fk["constrained_columns"], fk["referred_columns"], strict=False):
                references[local] = f"{target}.{remote}"

        unique_columns = set()
        for constraint in inspector.get_unique_constraints(name):
            unique_columns.update(constraint["column_names"])

        columns = [
            schemas.SchemaColumn(
                name=column["name"],
                type=str(column["type"]),
                nullable=bool(column["nullable"]),
                primary_key=column["name"] in primary_key,
                unique=column["name"] in unique_columns,
                references=references.get(column["name"]),
            )
            for column in inspector.get_columns(name)
        ]

        tables.append(schemas.SchemaTable(
            name=name,
            note=TABLE_NOTES.get(name),
            columns=columns,
            row_count=db.execute(_count_query(name)).scalar_one(),
        ))

    return schemas.DatabaseSchema(tables=tables)


def _count_query(table: str):
    from sqlalchemy import text

    # Имя таблицы приходит из интроспекции самой базы, а не от клиента,
    # поэтому подставляется прямо — параметром имя таблицы задать нельзя.
    return text(f'SELECT COUNT(*) FROM "{table}"')
