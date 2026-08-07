import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal
from app import models, auth
from app.routers import (
    auth_router, tags, catalog, templates, devices, interfaces, links, link_templates,
    topology, topology_groups,
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
               topology, topology_groups):
    app.include_router(module.router, dependencies=authenticated)


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
        # справочник типов устройств
        existing = {dt.name for dt in db.query(models.DeviceType).all()}
        for name, prefix in DEFAULT_DEVICE_TYPES:
            if name not in existing:
                db.add(models.DeviceType(name=name, code_prefix=prefix))
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
