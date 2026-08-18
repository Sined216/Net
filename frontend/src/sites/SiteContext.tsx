import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Center, Loader } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getSiteId, setSiteId } from '../api/client';
import { useSites } from '../api/hooks';
import type { SiteOut } from '../api/types';

/** Выбранная площадка — контекст всего, что человек видит.
 *
 * Живёт в трёх местах, и каждое нужно: в адресе страницы (чтобы схему можно
 * было послать ссылкой и собеседник открыл ту же фабрику), в localStorage
 * (чтобы после перезагрузки не выбирать заново) и в заголовке каждого
 * запроса (по нему сервер и фильтрует).
 */
interface SiteState {
  sites: SiteOut[];
  siteId: number | null;
  site: SiteOut | null;
  loading: boolean;
  selectSite: (siteId: number) => void;
}

const SiteContext = createContext<SiteState | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data: sites = [], isLoading } = useSites();
  const [searchParams, setSearchParams] = useSearchParams();
  const [siteId, setCurrent] = useState<number | null>(getSiteId);
  const queryClient = useQueryClient();

  const fromUrl = searchParams.get('site');

  useEffect(() => {
    if (sites.length === 0) return;

    // Приоритет у адреса: по ссылке человек попадает именно туда, куда его
    // позвали, даже если сам работал на другой площадке.
    const wanted = fromUrl ? parseInt(fromUrl, 10) : NaN;
    const chosen = sites.find((s) => s.id === wanted)
      // Площадка из прошлого сеанса могла быть удалена или у человека отобрали
      // доступ — тогда молча берём первую доступную, а не показываем пустоту.
      ?? sites.find((s) => s.id === siteId)
      ?? sites[0];

    if (chosen.id !== siteId) {
      setSiteId(chosen.id);
      setCurrent(chosen.id);
      // Данные предыдущей площадки в кэше больше не годятся ни одному
      // запросу — их не обновляют, а выбрасывают.
      queryClient.removeQueries();
    }
    if (String(chosen.id) !== fromUrl) {
      const next = new URLSearchParams(searchParams);
      next.set('site', String(chosen.id));
      setSearchParams(next, { replace: true });
    }
    // siteId и searchParams читаются, но не в списке зависимостей — так и
    // задумано. Эффект призван мирить внешние сигналы (список площадок
    // загрузился/сменился, по ссылке пришли с другим ?site=) с текущим
    // выбором; siteId в нём — не триггер, а состояние для сверки, и меняет
    // его либо этот же эффект, либо `selectSite`, которая уже сама
    // синхронизирует localStorage, адрес и кэш запросов за один проход —
    // заново гонять этот эффект после неё незачем. Из searchParams нужен
    // только параметр site, а он уже отдельно взят в fromUrl; остальные
    // параметры читаются свежими на каждый вызов эффекта безо всякого
    // намёка на устаревание — замыкание пересоздаётся при каждом рендере.
    // queryClient и setSearchParams стабильны сами по себе (один клиент на
    // всё приложение, сеттер react-router) — им бы всё равно нечего было
    // менять в поведении эффекта, даже если их дописать.
  }, [sites, fromUrl]);

  const selectSite = useCallback((next: number) => {
    if (next === siteId) return;
    setSiteId(next);
    setCurrent(next);
    queryClient.removeQueries();
    const params = new URLSearchParams(searchParams);
    params.set('site', String(next));
    setSearchParams(params);
  }, [siteId, searchParams, queryClient, setSearchParams]);

  const site = sites.find((s) => s.id === siteId) ?? null;

  // Мемоизировано по той же причине, что и в AuthContext: без этого каждый
  // потребитель useSite() перерисовывался бы вслед за провайдером, даже
  // когда ни площадка, ни их список не менялись. До, а не после раннего
  // return ниже — хуки не могут вызываться условно.
  const value = useMemo(
    () => ({ sites, siteId, site, loading: isLoading, selectSite }),
    [sites, siteId, site, isLoading, selectSite],
  );

  // Пока площадка не выбрана, страницы не показываются вовсе. Иначе первый
  // же рендер отправляет десяток запросов без заголовка площадки, и человек
  // при нескольких доступных площадках встречает пачку ошибок «не выбрана
  // площадка» вместо данных.
  if (site == null) {
    return (
      <Center h="100vh">
        {isLoading || sites.length > 0 ? <Loader /> : (
          <Alert color="yellow" variant="light" maw={520}>
            Вам не назначена ни одна площадка. Попросите администратора выдать доступ — без площадки
            смотреть нечего: всё оборудование описано внутри них.
          </Alert>
        )}
      </Center>
    );
  }

  return (
    <SiteContext.Provider value={value}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSite(): SiteState {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite должен использоваться внутри SiteProvider');
  return ctx;
}
