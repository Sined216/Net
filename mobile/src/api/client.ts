/**
 * Разговор с WireMap. Только в офисе — в цеху сети нет.
 *
 * Отличий от клиента сайта два, и оба из-за телефона:
 *
 * - адрес сервера вводится руками и хранится на устройстве. У сайта он
 *   известен (тот же origin), а телефон носят между офисом и цехом, и
 *   вписать адрес один раз человек должен сам.
 * - у каждого запроса свой предел ожидания. В офисной сети с телефона
 *   бывает «подключено, но не работает» (слабый Wi-Fi, чужая сеть), и
 *   запрос без предела висит до бесконечности вместо понятного отказа.
 */

import type {
  PasswordChange, PasswordPolicyOut, SyncSnapshot, SyncUploadRequest, SyncUploadResult, Token, UserOut,
} from './types';

/** Обычные запросы: если сервер не ответил за это время, он недоступен. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Снимок площадки — это вся спецификация разом, ему нужно больше. */
const SNAPSHOT_TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Connection {
  /** Адрес сервера, например `http://10.10.1.5:8000`. */
  baseUrl: string;
  token: string | null;
  /** Площадка, с которой работаем. Пусто — сервер выберет сам, если она одна. */
  siteId: number | null;
}

async function request<T>(
  connection: Connection,
  path: string,
  init: { method?: string; body?: unknown; form?: URLSearchParams; timeoutMs?: number } = {},
): Promise<T> {
  const base = connection.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (connection.token) headers.Authorization = `Bearer ${connection.token}`;
  if (connection.siteId != null) headers['X-Site-Id'] = String(connection.siteId);

  let body: string | undefined;
  if (init.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = init.form.toString();
  } else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  // AbortController, а не гонка с таймером: оборванный запрос должен и
  // вправду прекратиться, иначе телефон продолжает держать соединение,
  // о котором мы уже забыли.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET', headers, body, signal: abort.signal,
    });
  } catch (error) {
    // Разделяем «не успел» и «не смог»: человеку это разные починки —
    // подождать/сменить сеть или проверить адрес.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(0, 'Сервер не ответил вовремя. Проверьте, что телефон в сети офиса.');
    }
    throw new ApiError(0, `Не удалось связаться с WireMap по адресу ${base}. Проверьте адрес и сеть.`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Понятный текст вместо кода ответа: в цеху разбираться с «422» некогда. */
async function readError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.json();
    detail = typeof body?.detail === 'string'
      ? body.detail
      // Ошибки проверки данных приходят списком — склеиваем сообщения.
      : Array.isArray(body?.detail)
        ? body.detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join('; ')
        : '';
  } catch {
    // тело не JSON (например, страница ошибки от прокси) — останется код
  }
  if (detail) return detail;
  if (response.status === 401) return 'Требуется вход: логин или пароль не подошли, либо истёк сеанс.';
  // Свой сервер здесь всегда шлёт detail — эта ветка ловит нетиповой ответ
  // (например, страницу ошибки от чужого прокси), а не настоящую причину.
  if (response.status === 403) return 'Недостаточно прав для этого действия.';
  return `Сервер ответил ошибкой ${response.status}.`;
}

export interface Session {
  token: string;
  /** Адрес, по которому API в самом деле нашлось, — его и запоминаем. */
  baseUrl: string;
}

/** Вход. Заодно выясняет, где на этом сервере живёт API.
 *
 * В обычной установке WireMap стоит за nginx: интерфейс отдаётся с `/`, а
 * API проксируется с `/api/`. Человек знает адрес из браузера — без `/api`;
 * запрос на `/auth/login` попадает тогда в статику интерфейса, и та на POST
 * отвечает `405`. По такому сообщению догадаться дописать `/api` нельзя,
 * поэтому спрашиваем оба адреса сами.
 *
 * Перебор прекращается на первом же настоящем ответе API: `401` значит, что
 * API найдено, а не подошёл пароль, — искать дальше нечего.
 */
export async function login(baseUrl: string, username: string, password: string): Promise<Session> {
  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);

  const base = baseUrl.trim().replace(/\/+$/, '');
  const candidates = base.endsWith('/api') ? [base] : [base, `${base}/api`];

  for (const candidate of candidates) {
    try {
      const token = await request<Token>({ baseUrl: candidate, token: null, siteId: null }, '/auth/login', {
        method: 'POST', form,
      });
      return { token: token.access_token, baseUrl: candidate };
    } catch (error) {
      const notApiHere = error instanceof ApiError && (error.status === 404 || error.status === 405);
      if (!notApiHere) throw error;
    }
  }

  throw new ApiError(404, `По адресу ${base} отвечает не WireMap, а что-то другое.`
    + ' Проверьте адрес — обычно это тот же, что открываете в браузере.');
}

export const fetchSnapshot = (connection: Connection) =>
  request<SyncSnapshot>(connection, '/sync/snapshot', { timeoutMs: SNAPSHOT_TIMEOUT_MS });

export const uploadFindings = (connection: Connection, payload: SyncUploadRequest) =>
  request<SyncUploadResult>(connection, '/sync/upload', {
    method: 'POST', body: payload, timeoutMs: SNAPSHOT_TIMEOUT_MS,
  });

/** Кто вошёл — и не пора ли сменить пароль. Единственная ручка, которую
 * можно вызывать даже с временным или просроченным паролем (сервер не
 * держит её за общей проверкой — иначе сменить такой пароль было бы
 * нечем). */
export const me = (connection: Connection) => request<UserOut>(connection, '/auth/me');

export const changePassword = (connection: Connection, payload: PasswordChange) =>
  request<UserOut>(connection, '/auth/me/password', { method: 'POST', body: payload });

/** Требуемая длина пароля — та же, что видит сайт, а не своя копия числа. */
export const getPasswordPolicy = (connection: Connection) =>
  request<PasswordPolicyOut>(connection, '/settings/password-policy');
