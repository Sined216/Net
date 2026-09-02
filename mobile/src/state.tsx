/**
 * Общее состояние приложения: с каким сервером работаем и что за снимок в
 * руках.
 *
 * Всё это переживает перезапуск и лежит в оффлайн-базе: адрес сервера,
 * логин и сам вход — в таблице настроек (`db/settings.ts`), снимок и
 * очередь находок — в своих. Читается один раз при старте, до первого
 * кадра: `ready` поднимается, только когда прочитано всё. Экраны поэтому
 * могут спокойно брать начальные значения полей из настроек — к моменту их
 * первого рендера настройки уже на месте.
 *
 * Токен раньше жил только в памяти, и человек входил заново при каждом
 * запуске. Теперь он сохраняется: заказчик выбрал не набирать пароль
 * дважды за смену. Пароль по-прежнему не хранится нигде. Что это значит и
 * чем ограничено — в шапке `db/settings.ts`.
 *
 * `refresh()` намеренно не ходит в сеть — только читает локальную базу. Его
 * зовут и `AddDeviceScreen`/`AddLinkScreen`/`QueueScreen`, а это ровно те
 * экраны, которыми пользуются в цеху без связи; сетевой запрос там был бы
 * не про «обновить состояние», а про зависшую находку. Не пора ли сменить
 * пароль (`must_change_password`, срок по политике), приложение узнаёт в
 * других, уже сетевых точках — сразу после входа (`ConnectionScreen`) и на
 * отказе `/sync/*` (`SyncScreen`), а не сторожевым запросом отсюда.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Connection } from './api/client';
import { readSnapshotMeta } from './db/database';
import type { SnapshotMeta } from './db/database';
import { countPending } from './db/queue';
import type { PendingCounts } from './db/queue';
import {
  EMPTY_SETTINGS, clearToken, readSettings, writeConnection, writeSession,
} from './db/settings';
import type { Settings } from './db/settings';

interface AppState {
  meta: SnapshotMeta | null;
  pending: PendingCounts;
  settings: Settings;
  /** Готовы ли данные: до первого чтения базы показывать «пусто» нельзя —
   * человек решит, что снимок потерялся. */
  ready: boolean;
  /** Запомнить адрес и логин. Вызывается до запроса входа. */
  saveConnection: (baseUrl: string, username: string) => Promise<void>;
  /** Запомнить удачный вход. */
  saveSession: (token: string) => Promise<void>;
  /** Выход: гасит сеанс, адрес и логин остаются. */
  signOut: () => Promise<void>;
  /** Перечитать из базы: после загрузки снимка, добавления записи, выгрузки. */
  refresh: () => Promise<void>;
  /** Готовые параметры запроса — или null, если работать пока не с чем. */
  connection: (baseUrl?: string) => Connection | null;
}

const Context = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [pending, setPending] = useState<PendingCounts>({ devices: 0, links: 0 });
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [nextMeta, nextPending, nextSettings] = await Promise.all([
      readSnapshotMeta(), countPending(), readSettings(),
    ]);
    setMeta(nextMeta);
    setPending(nextPending);
    // Адрес мог остаться только у снимка — от установки, где настроек ещё не
    // было. Подхватываем его оттуда, чтобы не заставлять набирать заново.
    setSettings(nextSettings.baseUrl || !nextMeta
      ? nextSettings
      : { ...nextSettings, baseUrl: nextMeta.base_url });
    setReady(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveConnection = useCallback(async (baseUrl: string, username: string) => {
    await writeConnection(baseUrl, username);
    setSettings((prev) => ({ ...prev, baseUrl, username }));
  }, []);

  const saveSession = useCallback(async (token: string) => {
    await writeSession(token);
    setSettings(await readSettings());
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setSettings((prev) => ({ ...prev, token: null, tokenExpiresAt: null }));
  }, []);

  const connection = useCallback((baseUrl?: string): Connection | null => {
    const url = baseUrl ?? settings.baseUrl ?? meta?.base_url;
    if (!url) return null;
    return { baseUrl: url, token: settings.token, siteId: meta?.site_id ?? null };
  }, [meta, settings]);

  const value = useMemo<AppState>(
    () => ({
      meta, pending, settings, ready,
      saveConnection, saveSession, signOut, refresh, connection,
    }),
    [meta, pending, settings, ready, saveConnection, saveSession, signOut, refresh, connection],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error('useAppState вне AppStateProvider');
  return value;
}

/** Насколько устарел снимок. Решает человек — приложение только показывает.
 *
 * Порог в сутки: смена длиннее не бывает, и снимок старше почти наверняка
 * значит, что в офисе с тех пор что-то поправили.
 */
export function snapshotAge(takenAt: string): { hours: number; stale: boolean; text: string } {
  const hours = Math.max(0, (Date.now() - new Date(takenAt).getTime()) / 3_600_000);
  const text = hours < 1
    ? 'меньше часа назад'
    : hours < 24
      ? `${Math.round(hours)} ч назад`
      : `${Math.round(hours / 24)} дн назад`;
  return { hours, stale: hours >= 24, text };
}

/** До какого времени действует сеанс — коротким текстом для экрана связи. */
export function sessionUntil(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
