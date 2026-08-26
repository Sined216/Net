/**
 * Общее состояние приложения: с каким сервером работаем и что за снимок в
 * руках.
 *
 * Адрес сервера и площадка переживают перезапуск — они лежат в самой
 * оффлайн-базе, рядом со снимком, которому и принадлежат. Токен, наоборот,
 * живёт только в памяти: он действует 12 часов, за смену успевает
 * протухнуть, и хранить его на телефоне, который носят по цеху, незачем —
 * в офисе человек войдёт заново. Для чтения снимка вход и не нужен: он
 * уже на устройстве.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Connection } from './api/client';
import { readSnapshotMeta } from './db/database';
import type { SnapshotMeta } from './db/database';
import { countPending } from './db/queue';
import type { PendingCounts } from './db/queue';

interface AppState {
  meta: SnapshotMeta | null;
  pending: PendingCounts;
  token: string | null;
  /** Готовы ли данные: до первого чтения базы показывать «пусто» нельзя —
   * человек решит, что снимок потерялся. */
  ready: boolean;
  setToken: (token: string | null) => void;
  /** Перечитать из базы: после загрузки снимка, добавления записи, выгрузки. */
  refresh: () => Promise<void>;
  /** Готовые параметры запроса — или null, если работать пока не с чем. */
  connection: (baseUrl?: string) => Connection | null;
}

const Context = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [pending, setPending] = useState<PendingCounts>({ devices: 0, links: 0 });
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [nextMeta, nextPending] = await Promise.all([readSnapshotMeta(), countPending()]);
    setMeta(nextMeta);
    setPending(nextPending);
    setReady(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connection = useCallback((baseUrl?: string): Connection | null => {
    const url = baseUrl ?? meta?.base_url;
    if (!url) return null;
    return { baseUrl: url, token, siteId: meta?.site_id ?? null };
  }, [meta, token]);

  const value = useMemo<AppState>(
    () => ({ meta, pending, token, ready, setToken, refresh, connection }),
    [meta, pending, token, ready, refresh, connection],
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
