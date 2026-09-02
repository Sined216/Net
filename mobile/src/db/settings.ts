/**
 * Настройки связи: куда ходить и под кем.
 *
 * Живут в той же оффлайн-базе, но отдельно от снимка — и это важно.
 * `snapshot_meta` целиком удаляется при каждой загрузке снимка
 * (`saveSnapshot`), так что настройка, положенная туда, пережила бы ровно
 * один обмен.
 *
 * Хранилище общего вида «ключ — значение», а не колонки под каждое поле:
 * набор настроек будет меняться, а таблица — нет, и заводить миграции в
 * базе на телефоне ради этого не хочется.
 *
 * **Что здесь есть и чего нет.** Есть адрес, логин и токен. Пароля нет и
 * не будет: он вводится каждый раз. Токен — предъявительский, живёт 12
 * часов, и пока он жив, доступ к WireMap открыт всякому, у кого в руках
 * разблокированный телефон. Это осознанный размен: заказчик выбрал не
 * набирать пароль дважды в день. Ограничивают его два средства — срок,
 * который проверяется здесь при каждом чтении, и запрет автосохранения
 * Android (`allowBackup: false` в `app.json`), иначе база уехала бы в
 * личный Google Drive владельца телефона вместе со всей спецификацией.
 */

import { getDb } from './database';

/** Столько живёт токен на сервере — `access_token_expire_minutes`
 * в `backend/app/config.py`. Держим срок у себя, а не разбираем JWT:
 * разбирать нечем, а ошибиться в меньшую сторону не страшно. */
export const TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Запас, чтобы не пойти с токеном, который протухнет по дороге. */
const SAFETY_MS = 5 * 60 * 1000;

export interface Settings {
  baseUrl: string;
  username: string;
  token: string | null;
  /** Когда токен перестанет годиться, ISO. Пусто — токена нет. */
  tokenExpiresAt: string | null;
}

export const EMPTY_SETTINGS: Settings = {
  baseUrl: '', username: '', token: null, tokenExpiresAt: null,
};

/** Годен ли ещё сеанс. Отдельно от чтения базы, чтобы можно было проверить
 * без телефона. */
export function isSessionExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at <= now;
}

export function sessionExpiryFrom(now = Date.now()): string {
  return new Date(now + TOKEN_LIFETIME_MS - SAFETY_MS).toISOString();
}

async function readAll(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM setting');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function put(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value,
  );
}

/** Прочитать настройки. Протухший токен выбрасывается здесь же — наружу он
 * не выходит ни разу, и экраны не гадают, годен он или нет. */
export async function readSettings(): Promise<Settings> {
  const raw = await readAll();
  const expiresAt = raw.token_expires_at ?? null;

  if (raw.token && isSessionExpired(expiresAt)) {
    await clearToken();
    return { baseUrl: raw.base_url ?? '', username: raw.username ?? '', token: null, tokenExpiresAt: null };
  }
  return {
    baseUrl: raw.base_url ?? '',
    username: raw.username ?? '',
    token: raw.token ?? null,
    tokenExpiresAt: expiresAt,
  };
}

/** Адрес и логин — пишутся при попытке входа, до запроса: опечатка в пароле
 * не должна стирать длинный адрес, который человек только что набрал. */
export async function writeConnection(baseUrl: string, username: string): Promise<void> {
  await put('base_url', baseUrl);
  await put('username', username);
}

/** Токен — только после удачного входа, вместе со сроком. */
export async function writeSession(token: string): Promise<void> {
  await put('token', token);
  await put('token_expires_at', sessionExpiryFrom());
}

/** Выход: гасим сеанс, оставляя адрес и логин — их набирать заново незачем. */
export async function clearToken(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM setting WHERE key IN ('token', 'token_expires_at')");
}
