/** Тонкий типизированный клиент поверх fetch. Без axios — не нужен лишний
 * вес ради того, что здесь укладывается в одну функцию. */

export class ApiError extends Error {}

const BASE_URL_KEY = 'netdoc.baseUrl';
const TOKEN_KEY = 'netdoc.token';

/** Адрес API по умолчанию. В сборке для Docker подставляется `/api` — там
 * фронтенд и бэкенд за одним nginx, и запросы идут на тот же origin (ни
 * CORS, ни ввода адреса руками). При `npm run dev` остаётся прежний
 * localhost:8000: бэкенд поднимается отдельно. */
const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_KEY) || DEFAULT_BASE_URL;
}
export function setBaseUrl(url: string) {
  localStorage.setItem(BASE_URL_KEY, url.trim().replace(/\/$/, ''));
}
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** тело — form-urlencoded (только для /auth/login) */
  form?: URLSearchParams;
  /** файл (импорт устройств): multipart собирает браузер, свой
   * Content-Type ставить нельзя — потеряется граница частей. */
  upload?: FormData;
  query?: Record<string, string | number | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  // Второй аргумент нужен для относительного базового адреса (`/api`);
  // на абсолютный (`http://host:8000`) он не влияет — тот побеждает.
  const url = new URL(getBaseUrl() + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

/** FastAPI отдаёт ошибку либо строкой, либо — при провале валидации —
 * массивом по одному объекту на поле. Раньше массив уходил в тост как
 * JSON.stringify: пользователь видел `[{"type":"value_error","loc":...}]`
 * вместо «management_ip: не похоже на IP-адрес». */
function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return detail ? JSON.stringify(detail) : '';

  return (detail as ValidationIssue[])
    .map((issue) => {
      const message = (issue.msg ?? '').replace(/^Value error,\s*/, '');
      // loc — путь вида ["body", "management_ip"]; полезен только хвост.
      const field = issue.loc?.filter((part) => part !== 'body').at(-1);
      return field ? `${field}: ${message}` : message;
    })
    .filter(Boolean)
    .join('\n');
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, form, upload, query } = opts;
  const headers: Record<string, string> = {};
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let payload: BodyInit | undefined;
  if (upload) {
    payload = upload;
  } else if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { method, headers, body: payload });
  } catch (e) {
    throw new ApiError(`Не удалось подключиться к ${getBaseUrl()} (${(e as Error).message})`);
  }

  // Пока чтение было открыто, истёкший токен ломал только правку. Теперь
  // токен нужен всем запросам, поэтому просроченная сессия иначе выглядела
  // бы как каскад красных тостов на каждой странице.
  if (res.status === 401 && auth) {
    setToken(null);
    if (window.location.pathname !== '/login') window.location.assign('/login');
    throw new ApiError('Сессия истекла — войдите заново');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : res.statusText;
    throw new ApiError(formatDetail(detail) || res.statusText);
  }
  return data as T;
}
