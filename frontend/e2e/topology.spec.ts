import { expect, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { ensureUiUser, seedTopology } from './fixtures';

/**
 * Схема связей на медленном API.
 *
 * Здесь ловится ошибка, из-за которой страница показывала чёрный экран:
 * пока часть запросов ещё не ответила, эффект построения схемы считал
 * данные изменившимися на каждый рендер и уходил в бесконечный цикл
 * setNodes -> рендер -> setNodes, пока React не падал с «Maximum update
 * depth exceeded». Проявлялось через раз — успевали запросы ответить
 * быстро, и цикл обрывался сам. Поэтому задержка задаётся принудительно.
 */

const SLOW_MS = 1500;

/** Безобидный шум браузера: срабатывает на любой перерисовке, к которой
 * привязан ResizeObserver (схема следит им за размером полотна), приложение
 * при этом работает. Пропускать его нужно, иначе тест падал бы через раз. */
const HARMLESS = /ResizeObserver loop/;

async function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!HARMLESS.test(error.message)) errors.push(error.message);
  });
  return errors;
}

let uiUser: { username: string; password: string };

async function signIn(page: Page) {
  await page.goto('/login');
  // Поля по порядку: адрес API, логин, пароль.
  await page.locator('input').nth(0).fill(API_URL);
  await page.locator('input').nth(1).fill(uiUser.username);
  await page.locator('input[type="password"]').fill(uiUser.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/devices/);
  // Под этим пользователем требования сменить пароль быть не должно —
  // иначе тесты смотрели бы интерфейс из-под модального окна.
  await expect(page.getByText('Пароль вашей учётной записи задавал не вы')).toBeHidden();
}

/** Придерживает ответы API, оставляя вход быстрым — иначе не залогиниться. */
async function delayApi(page: Page, ms: number) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const isApi = url.startsWith(API_URL) && !url.includes('/auth/');
    if (isApi) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.beforeAll(async () => {
  uiUser = await ensureUiUser();
  await seedTopology();
});

test('схема рисуется, когда часть запросов отвечает с задержкой', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await signIn(page);
  await delayApi(page, SLOW_MS);

  await page.goto('/topology');

  await expect(page.getByRole('heading', { name: 'Схема связей' })).toBeVisible();
  await expect(page.locator('[data-type="netdoc.Device"]').first()).toBeVisible();

  // Приложение не должно упасть: пустой #root — это и есть «чёрный экран».
  const rootChildren = await page.evaluate(() => document.getElementById('root')?.children.length ?? 0);
  expect(rootChildren, 'страница пуста — приложение упало').toBeGreaterThan(0);
  expect(errors, 'необработанные ошибки на странице').toEqual([]);
});

test('повторные открытия схемы не роняют страницу', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await signIn(page);
  // Разброс задержек: цикл возникал не при любой раскладке во времени,
  // поэтому проверяем несколько разных.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(API_URL) && !url.includes('/auth/')) {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 1200)));
    }
    await route.continue();
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto('/topology');
    await expect(page.locator('[data-type="netdoc.Device"]').first()).toBeVisible();
    expect(errors, `ошибка на открытии №${attempt}`).toEqual([]);
  }
});

test('устройства и связи открываются на медленном API', async ({ page }) => {
  const errors = await collectPageErrors(page);
  await signIn(page);
  await delayApi(page, SLOW_MS);

  await page.goto('/devices');
  await expect(page.getByRole('heading', { name: 'Устройства' })).toBeVisible();

  await page.goto('/links');
  await expect(page.getByRole('heading', { name: 'Связи между портами' })).toBeVisible();

  expect(errors).toEqual([]);
});
