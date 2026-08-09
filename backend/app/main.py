import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError, IntegrityError

from app.config import settings
from app.database import SessionLocal
from app import models, auth
from app.routers import (
    auth_router, tags, catalog, templates, devices, interfaces, links, link_templates,
    topology, topology_groups, schema,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("netdoc")

app = FastAPI(title="Network Documentation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # Авторизация идёт заголовком Authorization, а не куками, поэтому
    # credentials браузеру пересылать не нужно. Заодно снимается конфликт:
    # allow_credentials вместе со звёздочкой в origins всё равно не работает.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Все прикладные роутеры подключаются с обязательной авторизацией на уровне
# роутера, а не хендлера: иначе новый GET-эндпоинт легко забыть защитить —
# именно так и получилось, что вся карта сети с IP и MAC отдавалась без
# токена. Исключения ровно два и они осознанные: вход (/auth/login, внутри
# auth_router) и /health для проб контейнера.
authenticated = [Depends(auth.get_current_user)]

app.include_router(auth_router.router)
for module in (tags, catalog, templates, devices, interfaces, links, link_templates,
               topology, topology_groups, schema):
    app.include_router(module.router, dependencies=authenticated)


@app.exception_handler(IntegrityError)
def on_integrity_error(request: Request, exc: IntegrityError):
    """Страховка от пятисоток на нарушении целостности.

    Ссылка на несуществующую запись или повтор уникального значения — это
    ошибка запроса, а не поломка сервера: клиенту нужен внятный отказ, а не
    «Internal Server Error». Места, где понятно, о чём именно речь, отвечают
    сами и подробнее; сюда доезжает всё остальное.
    """
    log.warning("нарушение целостности на %s %s: %s", request.method, request.url.path, exc.orig)
    return JSONResponse(
        status_code=409,
        content={"detail": "Запись ссылается на то, чего нет, либо нарушает уникальность. "
                           "Обновите страницу — данные могли измениться в другой вкладке."},
    )


@app.exception_handler(DataError)
def on_data_error(request: Request, exc: DataError):
    """Значение не влезло в колонку — это тоже ошибка запроса.

    Слишком длинное число или строка не должны выглядеть как поломка
    сервера: клиенту нужно понять, что именно он прислал не так.
    """
    log.warning("значение не принято базой на %s %s: %s", request.method, request.url.path, exc.orig)
    return JSONResponse(
        status_code=422,
        content={"detail": "Значение не подходит по типу или размеру — проверьте введённые числа и строки."},
    )


# (название, префикс кода устройства — SW-0001, SRV-0002...)
DEFAULT_DEVICE_TYPES = [
    ("Коммутатор", "SW"), ("Маршрутизатор", "RTR"), ("ПК/рабочая станция", "PC"),
    ("Сервер", "SRV"), ("ПЛК/контроллер", "PLC"), ("IP-камера", "CAM"),
    ("Точка доступа Wi-Fi", "AP"), ("Принтер", "PRN"), ("IP-телефон", "PHN"),
    ("Прочее", "MISC"),
]


@app.on_event("startup")
def on_startup():
    """Наполнение справочников. Схему создаёт не приложение, а миграции
    (`python -m app.db_upgrade` перед стартом uvicorn) — create_all умел
    только досоздавать таблицы и не замечал изменений в существующих."""
    db = SessionLocal()
    try:
        # Справочник типов устройств. Сверяемся и по названию, и по префиксу:
        # тип можно переименовать, и тогда «Коммутатор» по имени не найдётся,
        # а вставка нового с префиксом SW упрётся в уникальный индекс — до
        # этой проверки приложение просто не поднималось после переименования.
        rows = db.query(models.DeviceType).all()
        taken_names = {dt.name for dt in rows}
        taken_prefixes = {dt.code_prefix for dt in rows}
        for name, prefix in DEFAULT_DEVICE_TYPES:
            if name in taken_names or prefix in taken_prefixes:
                continue
            db.add(models.DeviceType(name=name, code_prefix=prefix))
            taken_names.add(name)
            taken_prefixes.add(prefix)
        db.commit()

        # первый администратор, если пользователей ещё нет
        if db.query(models.User).count() == 0:
            admin_username = settings.bootstrap_admin_username
            admin_password = settings.bootstrap_admin_password
            db.add(models.User(
                full_name="Administrator",
                username=admin_username,
                password_hash=auth.hash_password(admin_password),
                role="admin",
                # Пароль лежит в .env и виден всем, у кого есть доступ к
                # серверу, — интерфейс потребует сменить его при первом входе.
                must_change_password=True,
            ))
            db.commit()
            log.warning(
                "Создан администратор по умолчанию: %s / %s — СМЕНИТЕ ПАРОЛЬ",
                admin_username, admin_password,
            )
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
