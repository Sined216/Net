import { request, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../playwright.config';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'change-me-please';

export const credentials = { username: ADMIN_USERNAME, password: ADMIN_PASSWORD };

async function apiContext(): Promise<APIRequestContext> {
  const anonymous = await request.newContext({ baseURL: API_URL });
  const response = await anonymous.post('/auth/login', {
    form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(
      `Не удалось войти как ${ADMIN_USERNAME}: ${response.status()} ${await response.text()}. ` +
        'Проверьте BOOTSTRAP_ADMIN_PASSWORD у запущенного бэкенда.',
    );
  }
  const { access_token: token } = await response.json();
  await anonymous.dispose();

  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function json(api: APIRequestContext, method: 'post' | 'patch', path: string, data: unknown) {
  const response = await api[method](path, { data });
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}

/**
 * Наполняет базу минимумом, на котором видна схема: два устройства в одной
 * группе и связь между их портами. Тест сам готовит данные, чтобы не зависеть
 * от того, что лежит в базе разработчика.
 */
export async function seedTopology() {
  const api = await apiContext();

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
