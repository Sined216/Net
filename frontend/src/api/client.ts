/** Тонкий типизированный клиент поверх fetch. Без axios — не нужен лишний
 * вес ради того, что здесь укладывается в одну функцию. */

export class ApiError extends Error {}

const BASE_URL_KEY = 'netdoc.baseUrl';
const TOKEN_KEY = 'netdoc.token';

export function getBaseUrl(): string {
  return localStorage.getItem(BASE_URL_KEY) || 'http://localhost:8000';
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
  query?: Record<string, string | number | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(getBaseUrl() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, form, query } = opts;
  const headers: Record<string, string> = {};
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let payload: BodyInit | undefined;
  if (form) {
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
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data as T;
}
