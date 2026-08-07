import os
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine, SessionLocal
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
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(tags.router)
app.include_router(catalog.router)
app.include_router(templates.router)
app.include_router(devices.router)
app.include_router(interfaces.router)
app.include_router(links.router)
app.include_router(link_templates.router)
app.include_router(topology.router)
app.include_router(topology_groups.router)


# (название, префикс кода устройства — SW-0001, SRV-0002...)
DEFAULT_DEVICE_TYPES = [
    ("Коммутатор", "SW"), ("Маршрутизатор", "RTR"), ("ПК/рабочая станция", "PC"),
    ("Сервер", "SRV"), ("ПЛК/контроллер", "PLC"), ("IP-камера", "CAM"),
    ("Точка доступа Wi-Fi", "AP"), ("Принтер", "PRN"), ("IP-телефон", "PHN"),
    ("Прочее", "MISC"),
]


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
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
            admin_username = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "admin")
            admin_password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "change-me-please")
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
