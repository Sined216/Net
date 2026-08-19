import { expect, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

/** Вход в интерфейс под уже заведённым пользователем (`ensureUiUser` /
 * `createPendingPasswordUser` из fixtures.ts). Поля формы по порядку: адрес
 * API, логин, пароль — так же, как в e2e/topology.spec.ts. */
export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.locator('input').nth(0).fill(API_URL);
  await page.locator('input').nth(1).fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

/** Перехватить GET на `path` (например `/devices`) и ответить `status`.
 * Не трогает остальные запросы — вход и площадки должны отработать как
 * обычно. */
export async function failRequest(page: Page, path: string, status: number) {
  await page.route(`${API_URL}${path}?*`, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status, contentType: 'application/json', body: '{"detail":"внутренняя ошибка сервера"}' });
  });
  // Точный путь без query — /vlans и /tags отдают список без параметров по
  // умолчанию, шаблон с «?*» их не поймает.
  await page.route(`${API_URL}${path}`, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status, contentType: 'application/json', body: '{"detail":"внутренняя ошибка сервера"}' });
  });
}

/** Кнопки-иконки без доступного имени на текущей странице — как в живом
 * прогоне проверки удобства: иконка есть, а до неё ни aria-label, ни
 * title, ни текста внутри кнопки. */
export async function iconButtonsWithoutName(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0;
    document.querySelectorAll('button svg').forEach((svg) => {
      const btn = svg.closest('button');
      if (!btn || btn.offsetParent === null) return;
      const hasName = btn.getAttribute('aria-label') || btn.getAttribute('title')
        || (btn.textContent ?? '').trim().length > 0;
      if (!hasName) count++;
    });
    return count;
  });
}

/** Кнопок правки/удаления в самом DOM — не «спрятаны стилем», а их нет
 * совсем (находка 10: display:none оставлял их доступными скринридеру). */
export async function editDeleteButtonsInDom(page: Page): Promise<number> {
  return page.evaluate(() => {
    let count = 0;
    document.querySelectorAll('button svg').forEach((svg) => {
      const cls = [...svg.classList].find((c) => /tabler-icon-(edit|pencil|trash)$/.test(c));
      if (cls) count++;
    });
    return count;
  });
}

export async function expectNoForcedPasswordModal(page: Page) {
  await expect(page.getByText('Пароль вашей учётной записи задавал не вы')).toBeHidden();
}
