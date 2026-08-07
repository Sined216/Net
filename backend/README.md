# Network Documentation Backend

FastAPI + PostgreSQL. Модель данных: `sites → devices → interfaces → links`
(см. обсуждение схемы — любое устройство может иметь от 1 до N портов,
связь соединяет два интерфейса напрямую, без привязки к «только коммутаторам»).

## Запуск (Docker, рекомендуется)

```bash
cp .env.example .env
# отредактируйте .env — задайте SECRET_KEY и пароль администратора
docker compose up -d --build
```

API поднимется на `http://<адрес-сервера>:8000`.
Документация (Swagger UI): `http://<адрес-сервера>:8000/docs`.

При первом запуске автоматически:
- создаются все таблицы,
- заполняется справочник типов устройств,
- создаётся администратор (email/пароль — из `.env`, или
  `admin@factory.local` / `change-me-please` по умолчанию — **смените сразу после первого входа**).

## Запуск локально без Docker

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://netdoc:netdoc@localhost:5432/netdoc
uvicorn app.main:app --reload
```
Потребуется локально поднятый PostgreSQL с базой `netdoc`.

## Аутентификация

`POST /auth/login` (form-data: `username`=email, `password`) → `access_token`.
Далее передавать `Authorization: Bearer <token>`.

Роли: `admin` (полный доступ + управление пользователями),
`editor` (может создавать/менять устройства, интерфейсы, связи),
`viewer` (только чтение).

## Основные эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/login` | вход |
| POST | `/auth/users` | создать пользователя (только admin) |
| GET/POST | `/sites` | площадки/цеха |
| GET | `/device-types` | справочник типов устройств |
| GET/POST | `/vlans` | VLAN |
| GET/POST | `/devices` | устройства (можно сразу с массивом `interfaces`) |
| GET/PATCH/DELETE | `/devices/{id}` | одно устройство |
| GET/POST | `/devices/{id}/interfaces` | интерфейсы устройства |
| PATCH/DELETE | `/interfaces/{id}` | изменить/удалить интерфейс |
| GET/POST | `/links` | связи между интерфейсами |
| PATCH/DELETE | `/links/{id}` | изменить/удалить связь |
| GET | `/search?query=` | поиск по IP/MAC/имени |
| GET | `/topology` | узлы+рёбра для визуализации схемы |

## Пример: задокументировать связь

```bash
# 1. Создать коммутатор с 24 портами
POST /devices
{
  "code": "SW-01", "name": "Коммутатор цех №1",
  "device_type_id": 1, "management_ip": "10.10.1.2",
  "site_id": 1, "location": "Шкаф ШК-1",
  "interfaces": [{"label": "1", "port_number": 1}, {"label": "2", "port_number": 2}, ...]
}

# 2. Создать станок как устройство с одним интерфейсом
POST /devices
{
  "code": "PLC-05", "name": "Станок ЧПУ №5", "device_type_id": 5,
  "interfaces": [{"label": "eth0", "ip": "10.10.20.15"}]
}

# 3. Связать порт коммутатора и интерфейс станка
POST /links
{ "interface_a_id": <id порта SW-01>, "interface_b_id": <id eth0 станка>,
  "media_type": "copper", "cable_category": "cat6", "length_m": 40 }
```

Полное описание схемы БД — в `schema.sql` (передан ранее).

## Дальнейшие шаги (не входят в этот пакет)

- Alembic для миграций (сейчас таблицы создаются `create_all` при старте — подходит
  для старта, но при изменении схемы в будущем миграции удобнее).
- Фронтенд, обращающийся к этому API (аналог интерактивного прототипа, который
  делали раньше, но с реальным бэкендом и многопользовательским доступом).
- Фоновый воркер SNMP/LLDP-опроса, который будет создавать связи с `source=snmp`
  и выставлять `confirmed=false` до подтверждения человеком.
