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

async function json(api: APIRequestContext, method: 'post' | 'patch' | 'put', path: string, data: unknown) {
  const response = await api[method](path, { data });
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}

/**
 * Пароль встроенного администратора после первого входа — может отличаться
 * от `ADMIN_PASSWORD` (см. `ensureAdminReady`). Значение, на которое меняем,
 * фиксированное и детерминированное — не случайное, — специально затем,
 * чтобы попытка входа была идемпотентной: Playwright может поднять для
 * оставшихся тестов новый воркер после падения одного теста, и в свежем
 * воркере это же самое место в коде выполнится заново, уже не зная, что
 * какой-то другой воркер пароль уже сменил.
 */
const ADMIN_PASSWORD_ROTATED = `${ADMIN_PASSWORD}-e2e-2026`;
let adminPassword = ADMIN_PASSWORD;
let adminReady: Promise<void> | null = null;

async function tryLoginAsAdmin(password: string): Promise<boolean> {
  const anonymous = await request.newContext({ baseURL: API_URL });
  const response = await anonymous.post('/auth/login', { form: { username: ADMIN_USERNAME, password } });
  await anonymous.dispose();
  return response.ok();
}

/**
 * Бустрап-администратор заведён с `must_change_password=true` — на чистой
 * базе так всегда (см. `app/main.py:prepare_reference_data`). Пока флаг не
 * снят, сервер отбивает 403 на любой POST/PATCH/PUT от его имени, включая
 * заведение тестового пользователя (`app/auth.py:require_password_changed`
 * держит и `auth_router`, не только остальные роутеры). Меняем пароль на
 * фиксированный для этого прогона и дальше входим уже им — и пробуем его
 * первым же, если исходный ADMIN_PASSWORD больше не подходит (значит, смену
 * уже сделал другой воркер этого же прогона).
 */
async function ensureAdminReady(): Promise<void> {
  if (!adminReady) {
    adminReady = (async () => {
      if (await tryLoginAsAdmin(ADMIN_PASSWORD)) {
        adminPassword = ADMIN_PASSWORD;
      } else if (await tryLoginAsAdmin(ADMIN_PASSWORD_ROTATED)) {
        adminPassword = ADMIN_PASSWORD_ROTATED;
      } else {
        throw new Error(
          `Не удалось войти как ${ADMIN_USERNAME} ни с ADMIN_PASSWORD, ни с уже сменённым паролем.`,
        );
      }

      const api = await contextFor(ADMIN_USERNAME, adminPassword);
      const me = await (await api.get('/auth/me')).json();
      if (me.must_change_password) {
        await json(api, 'post', '/auth/me/password', {
          current_password: adminPassword, new_password: ADMIN_PASSWORD_ROTATED,
        });
        adminPassword = ADMIN_PASSWORD_ROTATED;
      }
      await api.dispose();
    })();
  }
  await adminReady;
}

async function adminContext(): Promise<APIRequestContext> {
  await ensureAdminReady();
  return contextFor(ADMIN_USERNAME, adminPassword);
}

/**
 * Заводит пользователя нужной роли и выдаёт ему доступ ко всем площадкам —
 * без этого шага человеку показывать нечего (см. комментарий у вызовов
 * ниже). Пароль на выходе — тот, что назначил админ: `must_change_password`
 * ещё не снят.
 *
 * Логин уникален для прогона: пароль, назначенный админом, тоже требует
 * смены, а сменить его можно только один раз. Переиспользовать учётную
 * запись между прогонами дороже, чем завести новую.
 */
async function createUserWithSiteAccess(
  role: 'admin' | 'editor' | 'viewer', fullName: string,
): Promise<{ username: string; temporaryPassword: string; id: number }> {
  const admin = await adminContext();
  const username = `e2e-${role}-${Date.now()}`;
  const temporary = 'e2e-vremennyj-parol';

  const created = await json(admin, 'post', '/auth/users', {
    full_name: fullName, username, password: temporary, role,
  });

  // Площадки нужно выдать явно: по роли их видит только администратор, а
  // всем остальным без площадки показывать нечего — вместо схемы страница
  // сообщает, что доступа нет. Появилось это вместе с изоляцией площадок,
  // уже после самих тестов.
  const sites = await (await admin.get('/sites')).json();
  for (const site of sites) {
    const access: number[] = await (await admin.get(`/sites/${site.id}/access`)).json();
    await json(admin, 'put', `/sites/${site.id}/access`, {
      user_ids: [...new Set([...access, created.id])],
    });
  }
  await admin.dispose();

  return { username, temporaryPassword: temporary, id: created.id };
}

/**
 * Заводит пользователя, под которым тесты работают в интерфейсе, и сразу
 * снимает у него требование сменить пароль.
 *
 * Под администратором ходить нельзя: ему при первом запуске взводится то же
 * требование, и поверх страницы висит модальное окно, которое нельзя
 * закрыть, — тесты проверяли бы интерфейс из-под него.
 */
export async function ensureUiUser(role: 'editor' | 'viewer' = 'editor'): Promise<{ username: string; password: string }> {
  const { username, temporaryPassword } = await createUserWithSiteAccess(
    role, role === 'viewer' ? 'Тестовый смотрящий' : 'Тестовый пользователь',
  );

  // Смена пароля владельцем снимает требование сменить пароль.
  const own = await contextFor(username, temporaryPassword);
  await json(own, 'post', '/auth/me/password', {
    current_password: temporaryPassword,
    new_password: UI_PASSWORD,
  });
  await own.dispose();

  return { username, password: UI_PASSWORD };
}

/**
 * Заводит пользователя, у которого требование сменить пароль ещё стоит —
 * ровно то состояние, в котором систему видит только что нанятый человек.
 * Пароль сменить предстоит самому тесту через интерфейс, а не здесь через
 * API: тест проверяет именно этот путь (находка 1 проверки удобства).
 */
export async function createPendingPasswordUser(
  role: 'editor' | 'viewer' = 'viewer',
): Promise<{ username: string; temporaryPassword: string }> {
  const { username, temporaryPassword } = await createUserWithSiteAccess(role, 'Новый сотрудник');
  return { username, temporaryPassword };
}

/**
 * Наполняет базу минимумом, на котором видна схема: два устройства в одной
 * группе и связь между их портами. Тест сам готовит данные, чтобы не зависеть
 * от того, что лежит в базе разработчика.
 */
export async function seedTopology() {
  const api = await adminContext();

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

/**
 * Наполняет базу по строке-другой во всех разделах разом: разъём, модуль,
 * шаблон устройства с портами, два связанных устройства, тег, VLAN.
 * Нужно там, где проверяется не одна страница, а вид приложения в целом
 * (доступные имена кнопок, видимость правки у смотрящего) — на пустых
 * списках такие проверки прошли бы, ничего не проверив.
 */
export async function seedCatalogSample() {
  const api = await adminContext();
  const stamp = Date.now();

  const types = await (await api.get('/device-types')).json();
  const connector = await json(api, 'post', '/connector-types', { name: `E2E RJ45 ${stamp}` });
  await json(api, 'post', '/modules', { name: `E2E SFP ${stamp}`, connector_id: connector.id });

  const template = await json(api, 'post', '/device-templates', {
    name: `E2E модель ${stamp}`,
    device_type_id: types[0].id,
    interfaces: [
      { label: 'Порт 1', port_number: 1, connector_id: connector.id },
      { label: 'Порт 2', port_number: 2, connector_id: connector.id },
    ],
  });

  const tag = await json(api, 'post', '/tags', { name: `E2E тег ${stamp}` });
  const vlan = await json(api, 'post', '/vlans', { vlan_number: (stamp % 4000) + 1, name: `E2E VLAN ${stamp}` });

  const first = await json(api, 'post', '/devices', { template_id: template.id, name: `E2E устройство А ${stamp}` });
  const second = await json(api, 'post', '/devices', { template_id: template.id, name: `E2E устройство Б ${stamp}` });
  await json(api, 'post', '/links', {
    interface_a_id: first.interfaces[0].id,
    interface_b_id: second.interfaces[0].id,
  });
  await json(api, 'put', `/devices/${first.id}/tags`, { tag_ids: [tag.id], version: first.version });

  await api.dispose();
  return { connector, template, tag, vlan, first, second };
}
