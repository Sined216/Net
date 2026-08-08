import { request, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../playwright.config';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'change-me-please';

/** Пароль пользователя, под которым ходят тесты интерфейса. */
const UI_PASSWORD = 'e2e-postoyannyj-parol';

async function login(username: string, password: string): Promise<string> {
  const anonymous = await request.newContext({ baseURL: API_URL });
  const response = await anonymous.post('/auth/login', { form: { username, password } });
  if (!response.ok()) {
    throw new Error(
      `Не удалось войти как ${username}: ${response.status()} ${await response.text()}. ` +
        'Проверьте BOOTSTRAP_ADMIN_PASSWORD у запущенного бэкенда.',
    );
  }
  const { access_token: token } = await response.json();
  await anonymous.dispose();
  return token;
}

async function contextFor(username: string, password: string): Promise<APIRequestContext> {
  const token = await login(username, password);
  return request.newContext({ baseURL: API_URL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

async function json(api: APIRequestContext, method: 'post' | 'patch', path: string, data: unknown) {
  const response = await api[method](path, { data });
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}

/**
 * Заводит пользователя, под которым тесты работают в интерфейсе.
 *
 * Под администратором ходить нельзя: ему при первом запуске взводится
 * требование сменить пароль, и поверх страницы висит модальное окно, которое
 * нельзя закрыть, — тесты проверяли бы интерфейс из-под него.
 *
 * Логин уникален для прогона: пароль, назначенный админом, тоже требует
 * смены, а сменить его можно только один раз. Переиспользовать учётную
 * запись между прогонами дороже, чем завести новую.
 */
export async function ensureUiUser(): Promise<{ username: string; password: string }> {
  const admin = await contextFor(ADMIN_USERNAME, ADMIN_PASSWORD);
  const username = `e2e-${Date.now()}`;
  const temporary = 'e2e-vremennyj-parol';

  await json(admin, 'post', '/auth/users', {
    full_name: 'Тестовый пользователь',
    username,
    password: temporary,
    role: 'editor',
  });
  await admin.dispose();

  // Смена пароля владельцем снимает требование сменить пароль.
  const own = await contextFor(username, temporary);
  await json(own, 'post', '/auth/me/password', {
    current_password: temporary,
    new_password: UI_PASSWORD,
  });
  await own.dispose();

  return { username, password: UI_PASSWORD };
}

/**
 * Наполняет базу минимумом, на котором видна схема: два устройства в одной
 * группе и связь между их портами. Тест сам готовит данные, чтобы не зависеть
 * от того, что лежит в базе разработчика.
 */
export async function seedTopology() {
  const api = await contextFor(ADMIN_USERNAME, ADMIN_PASSWORD);

  const types = await (await api.get('/device-types')).json();
  const template = await json(api, 'post', '/device-templates', {
    name: `E2E коммутатор ${Date.now()}`,
    device_type_id: types[0].id,
    interfaces: [
      { label: 'Порт 1', port_number: 1 },
      { label: 'Порт 2', port_number: 2 },
    ],
  });

  const group = await json(api, 'post', '/topology-groups', {
    name: `E2E группа ${Date.now()}`,
    color: '#4dabf7',
  });

  const first = await json(api, 'post', '/devices', {
    template_id: template.id,
    name: 'E2E коммутатор цеха',
    topology_group_id: group.id,
  });
  const second = await json(api, 'post', '/devices', {
    template_id: template.id,
    name: 'E2E станок',
    topology_group_id: group.id,
  });

  await json(api, 'post', '/links', {
    interface_a_id: first.interfaces[0].id,
    interface_b_id: second.interfaces[0].id,
  });

  await api.dispose();
  return { first, second, group };
}
