/**
 * Оффлайн-хранилище телефона.
 *
 * Две вещи, живущие порознь:
 *
 * - **снимок** — то, что привезли из офиса. Только для чтения: в цеху
 *   спецификацию не правят, её сверяют. Полностью заменяется при каждой
 *   новой загрузке.
 * - **очередь** — то, что человек нашёл на месте. Копится в цеху и уезжает
 *   в WireMap, когда телефон вернулся в офисную сеть.
 *
 * Снимок держится в SQLite, а не в памяти и не в простом хранилище пар
 * «ключ-значение»: на площадке в тысячу устройств со всеми портами это
 * мегабайты, которые надо листать и искать по ним, — ровно то, для чего
 * база и нужна.
 *
 * Записи очереди получают `client_uuid` здесь же, ещё оффлайн: он и есть
 * ключ идемпотентности выгрузки (см. `backend/app/routers/sync.py`).
 * Выдай его сервер — повторная отправка при обрыве связи задваивала бы
 * записи, потому что второй раз телефон прислал бы их как новые.
 */

import * as SQLite from 'expo-sqlite';
import type { DeviceOut, InterfaceOut, LinkOut, SyncSnapshot } from '../api/types';

const DB_NAME = 'wiremap-field.db';

let handle: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return handle;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    -- Настройки связи: адрес, логин, токен. Снимку не принадлежат и его
    -- перезапись не переживают — потому и отдельная таблица (см. settings.ts).
    CREATE TABLE IF NOT EXISTS setting (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Снимок: что привезли из офиса. Целиком заменяется при загрузке.
    CREATE TABLE IF NOT EXISTS snapshot_meta (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      site_id      INTEGER NOT NULL,
      site_name    TEXT    NOT NULL,
      taken_at     TEXT    NOT NULL,
      base_url     TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device (
      id      INTEGER PRIMARY KEY,
      code    TEXT NOT NULL,
      name    TEXT,
      -- Всё устройство как есть, чтобы карточка показывала то же, что и сайт,
      -- не заводя колонку под каждое поле.
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS device_code ON device(code);
    CREATE TABLE IF NOT EXISTS iface (
      id        INTEGER PRIMARY KEY,
      device_id INTEGER NOT NULL,
      label     TEXT NOT NULL,
      payload   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS iface_device ON iface(device_id);
    CREATE TABLE IF NOT EXISTS link (
      id      INTEGER PRIMARY KEY,
      a_id    INTEGER,
      b_id    INTEGER,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );

    -- Очередь: что нашли в цеху. Уезжает в WireMap и там ждёт разбора.
    CREATE TABLE IF NOT EXISTS queued_device (
      client_uuid   TEXT PRIMARY KEY,
      name          TEXT,
      template_name TEXT,
      type_name     TEXT,
      management_ip TEXT,
      mac           TEXT,
      notes         TEXT,
      created_at    TEXT NOT NULL,
      -- 1 — сервер принял; строку не удаляем сразу, чтобы человек видел,
      -- что именно уехало, пока сам не очистит.
      sent          INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS queued_link (
      client_uuid   TEXT PRIMARY KEY,
      a_device_text TEXT,
      a_port_text   TEXT,
      b_device_text TEXT,
      b_port_text   TEXT,
      a_device_id   INTEGER,
      b_device_id   INTEGER,
      medium        TEXT,
      notes         TEXT,
      created_at    TEXT NOT NULL,
      sent          INTEGER NOT NULL DEFAULT 0
    );
  `);
  handle = db;
  return db;
}

export interface SnapshotMeta {
  site_id: number;
  site_name: string;
  taken_at: string;
  base_url: string;
}

export async function readSnapshotMeta(): Promise<SnapshotMeta | null> {
  const db = await getDb();
  return db.getFirstAsync<SnapshotMeta>('SELECT site_id, site_name, taken_at, base_url FROM snapshot_meta WHERE id = 1');
}

/** Записать привезённый снимок, заменив предыдущий.
 *
 * Всё одной транзакцией: оборвись запись на середине, в телефоне остался
 * бы наполовину старый, наполовину новый снимок — хуже, чем просто старый.
 */
export async function saveSnapshot(snapshot: SyncSnapshot, baseUrl: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM device; DELETE FROM iface; DELETE FROM link; DELETE FROM template; DELETE FROM snapshot_meta;');
    await db.runAsync(
      'INSERT INTO snapshot_meta (id, site_id, site_name, taken_at, base_url) VALUES (1, ?, ?, ?, ?)',
      snapshot.site_id, snapshot.site_name, snapshot.taken_at, baseUrl,
    );
    for (const device of snapshot.devices) {
      await db.runAsync(
        'INSERT INTO device (id, code, name, payload) VALUES (?, ?, ?, ?)',
        device.id, device.code, device.name ?? null, JSON.stringify(device),
      );
      for (const iface of device.interfaces ?? []) {
        await db.runAsync(
          'INSERT INTO iface (id, device_id, label, payload) VALUES (?, ?, ?, ?)',
          iface.id, device.id, iface.label, JSON.stringify(iface),
        );
      }
    }
    for (const link of snapshot.links) {
      await db.runAsync(
        'INSERT INTO link (id, a_id, b_id, payload) VALUES (?, ?, ?, ?)',
        link.id, link.interface_a_id ?? null, link.interface_b_id ?? null, JSON.stringify(link),
      );
    }
    for (const template of snapshot.templates) {
      await db.runAsync('INSERT INTO template (id, name) VALUES (?, ?)', template.id, template.name);
    }
  });
}

export async function countDevices(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM device');
  return row?.n ?? 0;
}

/** Устройства для списка — поиск делает база, а не перебор в памяти. */
export async function searchDevices(query: string, limit = 100): Promise<DeviceOut[]> {
  const db = await getDb();
  const trimmed = query.trim();
  const rows = trimmed
    ? await db.getAllAsync<{ payload: string }>(
      'SELECT payload FROM device WHERE code LIKE ? OR name LIKE ? ORDER BY code LIMIT ?',
      `%${trimmed}%`, `%${trimmed}%`, limit,
    )
    : await db.getAllAsync<{ payload: string }>('SELECT payload FROM device ORDER BY code LIMIT ?', limit);
  return rows.map((r) => JSON.parse(r.payload) as DeviceOut);
}

export async function readDevice(id: number): Promise<DeviceOut | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM device WHERE id = ?', id);
  return row ? (JSON.parse(row.payload) as DeviceOut) : null;
}

export async function readInterfaces(deviceId: number): Promise<InterfaceOut[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    'SELECT payload FROM iface WHERE device_id = ? ORDER BY id', deviceId,
  );
  return rows.map((r) => JSON.parse(r.payload) as InterfaceOut);
}

/** Связь, в которой участвует гнездо, — чтобы в цеху было видно, занято ли
 * оно по документации и чем именно. */
export async function readLinkForInterface(interfaceId: number): Promise<LinkOut | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM link WHERE a_id = ? OR b_id = ? LIMIT 1', interfaceId, interfaceId,
  );
  return row ? (JSON.parse(row.payload) as LinkOut) : null;
}

/** Связи сразу для всех гнёзд устройства.
 *
 * По одному запросу на порт получалось до полусотни обращений к базе на
 * каждое открытие карточки — а карточка в цеху открывается чаще всего.
 * Берём одним запросом и раскладываем по гнёздам в памяти.
 */
export async function readLinksForInterfaces(ids: number[]): Promise<Map<number, LinkOut>> {
  const found = new Map<number, LinkOut>();
  if (ids.length === 0) return found;
  const db = await getDb();
  const holes = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM link WHERE a_id IN (${holes}) OR b_id IN (${holes})`,
    ...ids, ...ids,
  );
  for (const row of rows) {
    const link = JSON.parse(row.payload) as LinkOut;
    // Связь может касаться сразу двух гнёзд одного устройства — записываем
    // её обоим концам, иначе у второго порт покажется свободным.
    if (link.interface_a_id != null) found.set(link.interface_a_id, link);
    if (link.interface_b_id != null) found.set(link.interface_b_id, link);
  }
  return found;
}

/** Название модели по её номеру — у устройства хранится только `template_id`,
 * а человеку в цеху нужен текст с корпуса, а не номер. */
export async function readTemplateName(templateId: number): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ name: string }>('SELECT name FROM template WHERE id = ?', templateId);
  return row?.name ?? null;
}

export async function listTemplateNames(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>('SELECT name FROM template ORDER BY name');
  return rows.map((r) => r.name);
}
