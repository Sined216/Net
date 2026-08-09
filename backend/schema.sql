-- =========================================================
-- СПРАВОЧНОЕ ОПИСАНИЕ схемы БД с комментариями.
-- Источник истины — миграции Alembic (alembic/versions/); этот файл
-- поддерживается вручную и нужен, чтобы модель данных можно было прочитать
-- целиком в одном месте. При расхождении верить миграциям.
--
-- Схема БД: документация физической сети завода (v4)
-- Модель: шаблон устройства (справочник моделей с портами)
--         -> устройство в спецификации оборудования (экземпляр)
--         -> интерфейсы (созданы из шаблона, статус вычисляется)
--         -> связи между интерфейсами
-- Группировка устройств — вложенные теги (device_tags), а не площадки:
-- устройство может быть помечено сразу несколькими тегами.
-- PostgreSQL 14+
-- =========================================================

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    full_name     TEXT NOT NULL,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Категория устройства (Коммутатор, Сервер, ПЛК...). code_prefix используется
-- для автогенерации читаемого кода устройства (SW-0001, SRV-0002...).
CREATE TABLE device_types (
    id           SERIAL PRIMARY KEY,
    name         TEXT UNIQUE NOT NULL,
    code_prefix  TEXT UNIQUE NOT NULL
);

INSERT INTO device_types (name, code_prefix) VALUES
    ('Коммутатор', 'SW'), ('Маршрутизатор', 'RTR'), ('ПК/рабочая станция', 'PC'),
    ('Сервер', 'SRV'), ('ПЛК/контроллер', 'PLC'), ('IP-камера', 'CAM'),
    ('Точка доступа Wi-Fi', 'AP'), ('Принтер', 'PRN'), ('IP-телефон', 'PHN'),
    ('Прочее', 'MISC');

-- Счётчик для генерации кодов устройств: по одному значению на префикс типа.
CREATE TABLE code_sequences (
    prefix      TEXT PRIMARY KEY,
    next_value  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vlans (
    id           SERIAL PRIMARY KEY,
    vlan_number  INTEGER UNIQUE NOT NULL,
    name         TEXT,
    subnet       CIDR,
    gateway      INET,
    dhcp_range   TEXT,
    notes        TEXT
);

-- Тег для группировки устройств — вложенный (parent_id), пришёл на замену
-- площадкам. Уникальность имени — в пределах одного родителя (у разных
-- родителей могут быть теги с одинаковым названием, как одноимённые папки
-- в разных каталогах).
CREATE TABLE tags (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    color      TEXT,
    UNIQUE (parent_id, name)
);

-- Шаблон устройства — описание модели техники "на бумаге": к какой
-- категории относится и какие у неё порты. Заводится один раз для модели
-- (например "Cisco Catalyst 2960-24TT"), а не для каждого физического
-- устройства.
CREATE TABLE device_templates (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,             -- напр. "Cisco Catalyst 2960-24TT"
    device_type_id INTEGER NOT NULL REFERENCES device_types(id),
    manufacturer   TEXT,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Разъём порта: то, что физически торчит из железки. SFP и подобные — не
-- разъём, а клетка (is_cage): разъём у них появляется вместе с модулем.
CREATE TABLE connector_types (
    id      SERIAL PRIMARY KEY,
    name    TEXT UNIQUE NOT NULL,            -- RJ45, SFP+, LC, M12...
    media   TEXT NOT NULL DEFAULT 'copper' CHECK (media IN ('copper','fiber','other')),
    is_cage BOOLEAN NOT NULL DEFAULT false
);

-- Модуль (трансивер), вставляемый в клетку. connector_id — разъём, который
-- он даёт наружу: LC у оптики, RJ45 у медного SFP.
CREATE TABLE transceiver_modules (
    id                SERIAL PRIMARY KEY,
    name              TEXT UNIQUE NOT NULL,
    cage_connector_id INTEGER REFERENCES connector_types(id) ON DELETE SET NULL,
    connector_id      INTEGER REFERENCES connector_types(id) ON DELETE SET NULL,
    notes             TEXT
);

-- Порты, которые есть у этой модели устройства. При добавлении устройства
-- в спецификацию оборудования эти строки копируются в interfaces.
CREATE TABLE device_template_interfaces (
    id           SERIAL PRIMARY KEY,
    template_id  INTEGER NOT NULL REFERENCES device_templates(id) ON DELETE CASCADE,
    -- Номер — место порта в ряду гнёзд: 1..N подряд, без пропусков. Им порт
    -- и опознаётся, он напечатан на корпусе. Раздаёт номера приложение.
    port_number  INTEGER NOT NULL,
    label        TEXT NOT NULL,               -- "Порт 1", "Gi0/1", "SFP1"...
    -- Разъём — свойство модели техники. Режима (доступ/транк) тут нет: он
    -- настраивается на конкретной железке.
    connector_id INTEGER REFERENCES connector_types(id) ON DELETE SET NULL,
    UNIQUE (template_id, port_number)
);

-- Группа устройств на топологии — отдельный от тегов параметр: ровно одна
-- группа на устройство (или ни одной), без вложенности. Теги множественные
-- и для жёсткой визуальной кластеризации не годятся (неясно, в какую рамку
-- класть устройство с двумя тегами) — это узкое поле только под схему.
CREATE TABLE topology_groups (
    id        SERIAL PRIMARY KEY,
    name      TEXT UNIQUE NOT NULL,
    color     TEXT,
    -- Группа внутри группы: цех — участок — линия. SET NULL, а не CASCADE:
    -- удаление цеха не уносит с собой участки вместе с их устройствами.
    parent_id INTEGER REFERENCES topology_groups(id) ON DELETE SET NULL,
    -- Рамка на схеме: своё положение и размер, а не подгонка под содержимое.
    -- Пусто, пока рамку ни разу не двигали, — тогда она считается по
    -- содержимому и запоминается при первой же правке.
    x         DOUBLE PRECISION,
    y         DOUBLE PRECISION,
    width     DOUBLE PRECISION,
    height    DOUBLE PRECISION
);
CREATE INDEX ix_topology_groups_parent_id ON topology_groups(parent_id);

-- Устройство в спецификации оборудования — экземпляр конкретного шаблона.
-- code генерируется автоматически (см. code_sequences), не вводится руками.
CREATE TABLE devices (
    id                  SERIAL PRIMARY KEY,
    template_id         INTEGER NOT NULL REFERENCES device_templates(id),
    code                TEXT UNIQUE NOT NULL,      -- сгенерировано: SW-0001, SRV-0002...
    name                TEXT,                      -- необязательное человеческое название
    management_ip       INET,
    location            TEXT,                      -- цех / шкаф / юнит (свободный текст)
    role                TEXT CHECK (role IN ('core','distribution','access')), -- только для коммутаторов
    install_date        DATE,
    notes               TEXT,
    topology_group_id   INTEGER REFERENCES topology_groups(id) ON DELETE SET NULL,
    topology_x          DOUBLE PRECISION,          -- сохранённая позиция узла на топологии
    topology_y          DOUBLE PRECISION,          -- (NULL, пока пользователь не перетащил узел руками)
    created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Устройство <-> тег: многие-ко-многим, без своих полей.
CREATE TABLE device_tags (
    device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (device_id, tag_id)
);

-- Порт/интерфейс устройства — создаётся автоматически из шаблона при
-- добавлении устройства, дальше его можно донастроить (IP/MAC/VLAN) или
-- добавить/удалить порт вручную (если в реальности их больше/меньше, чем
-- в шаблоне). Статус (свободен/подключён) нигде не хранится — вычисляется
-- по наличию записи в links.
CREATE TABLE interfaces (
    id             SERIAL PRIMARY KEY,
    device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    -- Номер уникален, название — просто подпись: два порта могут называться
    -- одинаково, но занимать разные гнёзда. Связь указывает на гнездо.
    port_number    INTEGER NOT NULL,
    label          TEXT NOT NULL,
    -- Из какого порта модели скопирован. Пусто — порт заведён руками на
    -- устройстве со съёмными картами. По номеру их сопоставлять нельзя:
    -- сняли карту, номера сомкнулись — и правка модели попадала в соседний порт.
    template_interface_id INTEGER REFERENCES device_template_interfaces(id) ON DELETE SET NULL,
    -- Разъём приходит из модели; модуль вставляется в клетку (SFP и т.п.) и
    -- определяет, какой разъём торчит из порта на самом деле.
    connector_id   INTEGER REFERENCES connector_types(id) ON DELETE SET NULL,
    module_id      INTEGER REFERENCES transceiver_modules(id) ON DELETE SET NULL,
    -- Режим порта — настройка конкретной железки.
    mode           TEXT CHECK (mode IN ('access','trunk','uplink')),
    vlan_id        INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
    trunk_vlan_ids INTEGER[],
    ip             INET,
    mac            MACADDR,
    notes          TEXT,
    UNIQUE (device_id, port_number)
);

-- Шаблон/пресет связи: тип среды передачи + категория кабеля (для меди:
-- cat5e/cat6/cat6a; для оптики: OM3/OM4/OS2 и т.п.) + оформление на
-- топологии (цвет, стиль линии). Длина и разъём — свойства конкретного
-- отрезка кабеля, поэтому в шаблон не входят и остаются на самой связи.
CREATE TABLE link_templates (
    id              SERIAL PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    media_type      TEXT NOT NULL CHECK (media_type IN ('copper','fiber','wireless','dac','other')),
    cable_category  TEXT,
    color           TEXT NOT NULL DEFAULT '#888888',
    line_style      TEXT NOT NULL DEFAULT 'solid' CHECK (line_style IN ('solid','dashed','dotted'))
);

-- Физическая связь: интерфейс A соединён с интерфейсом B. template_id
-- необязателен — быстрое подключение порта создаёт связь без шаблона,
-- присвоить его можно позже.
CREATE TABLE links (
    id               SERIAL PRIMARY KEY,
    interface_a_id   INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
    interface_b_id   INTEGER NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
    template_id      INTEGER REFERENCES link_templates(id) ON DELETE SET NULL,
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
    entity_type  TEXT NOT NULL,          -- device / device_template / interface / link / link_template / vlan / tag
    entity_id    INTEGER,
    old_value    JSONB,
    new_value    JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- Индексы
-- =========================================================
CREATE INDEX idx_devices_template        ON devices(template_id);
CREATE INDEX idx_device_tags_tag         ON device_tags(tag_id);
CREATE INDEX idx_tags_parent             ON tags(parent_id);
CREATE INDEX idx_template_ifaces_template ON device_template_interfaces(template_id);
CREATE INDEX idx_interfaces_device       ON interfaces(device_id);
CREATE INDEX idx_interfaces_vlan         ON interfaces(vlan_id);
CREATE INDEX idx_interfaces_ip           ON interfaces(ip);
CREATE INDEX idx_interfaces_mac          ON interfaces(mac);
CREATE INDEX idx_audit_entity            ON audit_log(entity_type, entity_id);

-- =========================================================
-- Примеры запросов
-- =========================================================

-- Найти по IP, на каком устройстве и порту он висит:
-- SELECT d.code, d.name, i.label
-- FROM interfaces i JOIN devices d ON d.id = i.device_id
-- WHERE i.ip = '10.10.20.15';

-- Все связи коммутатора SW-0001 с указанием, что на другом конце и на чём:
-- SELECT i1.label AS port_on_sw,
--        d2.code  AS other_device, i2.label AS other_port,
--        lt.media_type, lt.cable_category, l.length_m
-- FROM links l
-- JOIN interfaces i1 ON i1.id = l.interface_a_id
-- JOIN interfaces i2 ON i2.id = l.interface_b_id
-- JOIN devices d1 ON d1.id = i1.device_id
-- JOIN devices d2 ON d2.id = i2.device_id
-- LEFT JOIN link_templates lt ON lt.id = l.template_id
-- WHERE d1.code = 'SW-0001' OR d2.code = 'SW-0001';

-- Свободные (не задействованные в links) порты конкретного устройства:
-- SELECT i.label FROM interfaces i
-- WHERE i.device_id = 1
--   AND i.id NOT IN (SELECT interface_a_id FROM links UNION SELECT interface_b_id FROM links);

-- Сколько устройств заведено по каждому шаблону:
-- SELECT dt.name, COUNT(*) FROM devices d
-- JOIN device_templates dt ON dt.id = d.template_id
-- GROUP BY dt.name ORDER BY COUNT(*) DESC;

-- Все устройства с тегом "Цех 1" (без учёта дочерних тегов — теги
-- вложены для организации списка, а не для автоматического наследования):
-- SELECT d.code, d.name FROM devices d
-- JOIN device_tags dtg ON dtg.device_id = d.id
-- JOIN tags t ON t.id = dtg.tag_id
-- WHERE t.name = 'Цех 1';
