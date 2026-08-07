-- =========================================================
-- Схема БД: документация физической сети завода (v2)
-- Универсальная модель: устройство -> интерфейсы -> связи
-- Любое устройство может иметь от 1 до N портов/интерфейсов
-- PostgreSQL 14+
-- =========================================================

CREATE TABLE sites (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    address     TEXT,
    notes       TEXT
);

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    full_name     TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE device_types (
    id    SERIAL PRIMARY KEY,
    name  TEXT UNIQUE NOT NULL
);

INSERT INTO device_types (name) VALUES
    ('Коммутатор'),('Маршрутизатор'),('ПК/рабочая станция'),('Сервер'),
    ('ПЛК/контроллер'),('IP-камера'),('Точка доступа Wi-Fi'),
    ('Принтер'),('IP-телефон'),('Прочее');

CREATE TABLE vlans (
    id           SERIAL PRIMARY KEY,
    site_id      INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    vlan_number  INTEGER NOT NULL,
    name         TEXT,
    subnet       CIDR,
    gateway      INET,
    dhcp_range   TEXT,
    notes        TEXT,
    UNIQUE (site_id, vlan_number)
);

-- Любое сетевое устройство: коммутатор, сервер, ПЛК, камера и т.д.
CREATE TABLE devices (
    id             SERIAL PRIMARY KEY,
    code           TEXT UNIQUE NOT NULL,          -- напр. SW-01, SRV-DB1, PLC-12
    name           TEXT NOT NULL,
    device_type_id INTEGER NOT NULL REFERENCES device_types(id),
    model          TEXT,
    management_ip  INET,                          -- основной IP управления (если есть)
    site_id        INTEGER REFERENCES sites(id) ON DELETE SET NULL,
    location       TEXT,                          -- цех / шкаф / юнит
    role           TEXT CHECK (role IN ('core','distribution','access')), -- только для коммутаторов
    install_date   DATE,
    notes          TEXT,
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Порт/интерфейс устройства. У коммутатора их может быть 24-48,
-- у сервера с двумя сетевыми картами - 2, у камеры - 1.
CREATE TABLE interfaces (
    id             SERIAL PRIMARY KEY,
    device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    label          TEXT NOT NULL,                 -- "Порт 1", "Gi0/1", "NIC1", "eth0", "Wi-Fi"
    port_number    INTEGER,                       -- для сортировки/группировки портов коммутатора
    status         TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','up','down')),
    port_type      TEXT CHECK (port_type IN ('access','trunk','uplink')),  -- актуально для коммутаторов
    vlan_id        INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
    trunk_vlan_ids INTEGER[],
    ip             INET,                          -- IP именно этого интерфейса (не устройства целиком)
    mac            MACADDR,
    notes          TEXT,
    UNIQUE (device_id, label)
);

-- Физическая связь: интерфейс A соединён с интерфейсом B.
-- Не важно, что стоит по обе стороны - коммутатор, сервер, ПЛК и т.д.
-- Характеристики кабеля/среды передачи относятся к самой связи, а не к отдельному порту.
CREATE TABLE links (
    id               SERIAL PRIMARY KEY,
    interface_a_id   INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
    interface_b_id   INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
    media_type       TEXT CHECK (media_type IN ('copper','fiber','wireless','dac','other')),
    cable_category   TEXT,        -- для меди: cat5e/cat6/cat6a; для оптики: OM3/OM4/OS2 и т.п.
    connector_type   TEXT,        -- RJ45, LC, SC, ST, MPO...
    length_m         NUMERIC(6,1),
    speed_mbps       INTEGER,     -- на какой скорости реально работает линк (1000, 10000, 25000...)
    source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','snmp','lldp')),
    confirmed        BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at     TIMESTAMPTZ,
    notes            TEXT,
    updated_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (interface_a_id <> interface_b_id),
    CHECK (interface_a_id < interface_b_id)   -- канонический порядок, чтобы A-B и B-A не задваивались
);
-- Каждый интерфейс участвует не более чем в одной активной связи:
CREATE UNIQUE INDEX idx_links_unique_a ON links(interface_a_id);
CREATE UNIQUE INDEX idx_links_unique_b ON links(interface_b_id);
-- Примечание: этого достаточно на практике для команды 2-5 человек;
-- полную защиту от "интерфейс встречается и как A, и как B в разных связях"
-- дополнительно проверяет приложение при сохранении.

CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,          -- create / update / delete
    entity_type  TEXT NOT NULL,          -- device / interface / link / vlan / site
    entity_id    INTEGER,
    old_value    JSONB,
    new_value    JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Индексы
-- =========================================================
CREATE INDEX idx_devices_site        ON devices(site_id);
CREATE INDEX idx_devices_type        ON devices(device_type_id);
CREATE INDEX idx_interfaces_device   ON interfaces(device_id);
CREATE INDEX idx_interfaces_vlan     ON interfaces(vlan_id);
CREATE INDEX idx_interfaces_ip       ON interfaces(ip);
CREATE INDEX idx_interfaces_mac      ON interfaces(mac);
CREATE INDEX idx_audit_entity        ON audit_log(entity_type, entity_id);

-- =========================================================
-- Примеры запросов
-- =========================================================

-- Найти по IP, на каком устройстве и порту он висит:
-- SELECT d.code, d.name, i.label
-- FROM interfaces i JOIN devices d ON d.id = i.device_id
-- WHERE i.ip = '10.10.20.15';

-- Все связи коммутатора SW-01 с указанием, что на другом конце и на чём:
-- SELECT i1.label AS port_on_sw01,
--        d2.code  AS other_device, i2.label AS other_port,
--        l.media_type, l.cable_category, l.length_m
-- FROM links l
-- JOIN interfaces i1 ON i1.id = l.interface_a_id
-- JOIN interfaces i2 ON i2.id = l.interface_b_id
-- JOIN devices d1 ON d1.id = i1.device_id
-- JOIN devices d2 ON d2.id = i2.device_id
-- WHERE d1.code = 'SW-01' OR d2.code = 'SW-01';

-- Сколько у нас оптических линков против медных:
-- SELECT media_type, COUNT(*) FROM links GROUP BY media_type;

-- Все устройства с более чем одним активным (up) интерфейсом
-- (многопортовые устройства - серверы с резервированием и т.п.):
-- SELECT d.code, d.name, COUNT(*) AS active_interfaces
-- FROM interfaces i JOIN devices d ON d.id = i.device_id
-- WHERE i.status = 'up'
-- GROUP BY d.id, d.code, d.name
-- HAVING COUNT(*) > 1;
