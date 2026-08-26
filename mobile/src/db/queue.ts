/**
 * Очередь находок: что человек отметил в цеху и что уедет в WireMap.
 *
 * Записи не уходят в спецификацию оборудования напрямую — сервер кладёт их
 * в промежуточные таблицы, откуда человек переносит по одной, глядя на то,
 * что уже заведено (см. `backend/app/routers/sync.py`). Поэтому здесь всё
 * хранится так, как записал человек: «свитч у окна», «третий порт» —
 * опознавать это будут потом, в офисе.
 *
 * `client_uuid` выдаётся здесь, при создании записи, а не сервером: это
 * ключ идемпотентности выгрузки. Связь по дороге рвётся, телефон шлёт
 * пакет заново — с тем же ключом сервер узнаёт уже принятые записи и не
 * заводит их второй раз.
 */

import { getDb } from './database';
import type { SyncDeviceIn, SyncLinkIn } from '../api/types';

export interface QueuedDevice extends SyncDeviceIn {
  created_at: string;
  sent: number;
}

export interface QueuedLink extends SyncLinkIn {
  created_at: string;
  sent: number;
}

/** Ключ записи. Без внешних библиотек: `crypto.randomUUID` в React Native
 * есть не всегда, а тянуть пакет ради одной строки незачем. Случайности
 * здесь хватает — ключ должен быть уникален среди записей одного телефона,
 * а не криптостойким. */
function newUuid(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rnd()}-${rnd()}`;
}

export async function queueDevice(fields: Omit<SyncDeviceIn, 'client_uuid'>): Promise<string> {
  const db = await getDb();
  const uuid = newUuid();
  await db.runAsync(
    `INSERT INTO queued_device
       (client_uuid, name, template_name, type_name, management_ip, mac, notes, created_at, sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    uuid, fields.name ?? null, fields.template_name ?? null, fields.type_name ?? null,
    fields.management_ip ?? null, fields.mac ?? null, fields.notes ?? null,
    new Date().toISOString(),
  );
  return uuid;
}

export async function queueLink(fields: Omit<SyncLinkIn, 'client_uuid'>): Promise<string> {
  const db = await getDb();
  const uuid = newUuid();
  await db.runAsync(
    `INSERT INTO queued_link
       (client_uuid, a_device_text, a_port_text, b_device_text, b_port_text,
        a_device_id, b_device_id, medium, notes, created_at, sent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    uuid, fields.a_device_text ?? null, fields.a_port_text ?? null,
    fields.b_device_text ?? null, fields.b_port_text ?? null,
    fields.a_device_id ?? null, fields.b_device_id ?? null,
    fields.medium ?? null, fields.notes ?? null, new Date().toISOString(),
  );
  return uuid;
}

export async function listQueuedDevices(): Promise<QueuedDevice[]> {
  const db = await getDb();
  return db.getAllAsync<QueuedDevice>('SELECT * FROM queued_device ORDER BY created_at DESC');
}

export async function listQueuedLinks(): Promise<QueuedLink[]> {
  const db = await getDb();
  return db.getAllAsync<QueuedLink>('SELECT * FROM queued_link ORDER BY created_at DESC');
}

export interface PendingCounts {
  devices: number;
  links: number;
}

/** Сколько ещё не уехало — это число человек видит на главном экране. */
export async function countPending(): Promise<PendingCounts> {
  const db = await getDb();
  const devices = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM queued_device WHERE sent = 0');
  const links = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM queued_link WHERE sent = 0');
  return { devices: devices?.n ?? 0, links: links?.n ?? 0 };
}

/** Что отправлять: только неотправленное. */
export async function collectUnsent(): Promise<{ devices: SyncDeviceIn[]; links: SyncLinkIn[] }> {
  const db = await getDb();
  const devices = await db.getAllAsync<QueuedDevice>('SELECT * FROM queued_device WHERE sent = 0 ORDER BY created_at');
  const links = await db.getAllAsync<QueuedLink>('SELECT * FROM queued_link WHERE sent = 0 ORDER BY created_at');
  return {
    devices: devices.map(({ created_at: _c, sent: _s, ...rest }) => rest),
    links: links.map(({ created_at: _c, sent: _s, ...rest }) => rest),
  };
}

/** Пометить принятое сервером.
 *
 * По ключам из ответа, а не «всё, что отправляли»: сервер перечисляет
 * именно те, что у него есть, — и принятые сейчас, и принятые в прошлый
 * раз до обрыва связи. Записи не удаляются: человек должен видеть, что
 * именно уехало, и очистить сам.
 */
export async function markSent(uuids: string[]): Promise<void> {
  if (uuids.length === 0) return;
  const db = await getDb();
  const marks = uuids.map(() => '?').join(',');
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE queued_device SET sent = 1 WHERE client_uuid IN (${marks})`, ...uuids);
    await db.runAsync(`UPDATE queued_link SET sent = 1 WHERE client_uuid IN (${marks})`, ...uuids);
  });
}

/** Убрать уехавшее. Только по кнопке: пока человек не убрал, отправленное
 * остаётся на экране как отчёт о сделанном за смену. */
export async function clearSent(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM queued_device WHERE sent = 1; DELETE FROM queued_link WHERE sent = 1;');
}

export async function deleteQueuedDevice(uuid: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM queued_device WHERE client_uuid = ?', uuid);
}

export async function deleteQueuedLink(uuid: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM queued_link WHERE client_uuid = ?', uuid);
}
