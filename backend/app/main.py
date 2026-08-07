import os
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine, SessionLocal
from app import models, auth
from app.routers import auth_router, sites, catalog, devices, interfaces, links, topology

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
app.include_router(sites.router)
app.include_router(catalog.router)
app.include_router(devices.router)
app.include_router(interfaces.router)
app.include_router(links.router)
app.include_router(topology.router)


DEFAULT_DEVICE_TYPES = [
    "Коммутатор", "Маршрутизатор", "ПК/рабочая станция", "Сервер",
    "ПЛК/контроллер", "IP-камера", "Точка доступа Wi-Fi",
    "Принтер", "IP-телефон", "Прочее",
]


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # справочник типов устройств
        existing = {dt.name for dt in db.query(models.DeviceType).all()}
        for name in DEFAULT_DEVICE_TYPES:
            if name not in existing:
                db.add(models.DeviceType(name=name))
        db.commit()

        # первый администратор, если пользователей ещё нет
        if db.query(models.User).count() == 0:
            admin_email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@factory.local")
            admin_password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "change-me-please")
            db.add(models.User(
                full_name="Administrator",
                email=admin_email,
                password_hash=auth.hash_password(admin_password),
                role="admin",
            ))
            db.commit()
            log.warning(
                "Создан администратор по умолчанию: %s / %s — СМЕНИТЕ ПАРОЛЬ",
                admin_email, admin_password,
            )
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
