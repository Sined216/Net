import { expect, test, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { ensureUiUser, seedTopology, seedTwoShops } from './fixtures';

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


/**
 * Схема, которую ещё никто не расставлял руками, раскладывается при
 * открытии — а не показывается пружинным клубком.
 *
 * До этой правки положение узлов на такой схеме считала только пружинная
 * симуляция, а она про рамки групп не знает вовсе: карточки разных цехов
 * ложились вперемешку в один круг, а рамки, посчитанные по их содержимому,
 * оказывались одна поверх другой. На заводской сети из двух сотен железок
 * читать там было нечего.
 */
test('схема без сохранённых позиций открывается разложенной, а не клубком', async ({ page }) => {
  const errors = await collectPageErrors(page);
  const { groups, tag } = await seedTwoShops();
  await signIn(page);

  await page.goto('/topology');
  await expect(page.locator('[data-type="netdoc.Device"]').first()).toBeVisible();
  await pickTag(page, tag.name);
  // Раскладка асинхронная (ELK считает в отдельном потоке), поэтому ждём
  // именно её результата, а не просто появления карточек.
  await expect.poll(async () => framesOverlap(page, groups.map((g) => g.name)), {
    timeout: 30_000,
    message: 'рамки групп так и остались друг на друге',
  }).toBe(false);

  expect(errors).toEqual([]);
});

/** Оставить на схеме только устройства с этим тегом. Отбор считает сервер,
 * поэтому схема после него состоит ровно из заведённого тестом. */
async function pickTag(page: Page, name: string) {
  await page.getByPlaceholder('Все теги').click();
  await page.getByRole('option', { name }).click();
  await expect(page.locator('[data-type="netdoc.Device"]')).toHaveCount(12);
}

/** Пересекаются ли рамки перечисленных групп на экране. */
async function framesOverlap(page: Page, names: string[]): Promise<boolean> {
  return page.evaluate((wanted) => {
    const boxes = [...document.querySelectorAll('[data-type="netdoc.Group"]')]
      .filter((cell) => wanted.some((name) => (cell.textContent ?? '').includes(name)))
      .map((cell) => cell.getBoundingClientRect());
    if (boxes.length < wanted.length) return true;  // рамок меньше, чем групп, — считать нечего
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return true;
      }
    }
    return false;
  }, names);
}

/**
 * Чем дальше отодвинули схему, тем меньше на ней написано.
 *
 * Двести устройств в окно целиком не помещаются: вписать их значит
 * уменьшить схему вчетверо, и подписи превращаются в серую рябь — буква в
 * четыре пиксела не читается, но рисуется и мешает смотреть на то, что ещё
 * различимо.
 */
test('на отдалении подписи карточек уступают место рамкам', async ({ page }) => {
  const { tag } = await seedTwoShops();
  await signIn(page);
  await page.goto('/topology');
  await expect(page.locator('[data-type="netdoc.Device"]').first()).toBeVisible();
  await pickTag(page, tag.name);

  const paper = page.locator('.joint-paper');
  const title = page.locator('[data-type="netdoc.Device"] [joint-selector="title"]').first();
  const detail = () => paper.getAttribute('data-detail');

  // Уровень проставляется сразу, а не только после первого щелчка колесом.
  expect(await detail()).not.toBeNull();

  // Отъезжаем до упора: колесо от себя уменьшает.
  await page.mouse.move(700, 400);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 200);
  await expect.poll(detail, { timeout: 10_000 }).toBe('blocks');
  await expect(title).toBeHidden();

  // И обратно: подписи возвращаются.
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -200);
  await expect.poll(detail, { timeout: 10_000 }).toBe('full');
  await expect(title).toBeVisible();
});
