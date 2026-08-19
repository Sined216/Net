import { expect, test } from '@playwright/test';
import {
  createPendingPasswordUser, ensureUiUser, seedCatalogSample,
} from './fixtures';
import {
  editDeleteButtonsInDom, expectNoForcedPasswordModal, failRequest, iconButtonsWithoutName, signIn,
} from './helpers';

/**
 * Регрессии на уже найденные и починенные находки проверки удобства
 * (docs/UX-REVIEW-2026-08-18.md) — заход 7 плана: не гнаться за покрытием,
 * а не пустить обратно то, что уже один раз ломалось.
 */

let editor: { username: string; password: string };

test.beforeAll(async () => {
  editor = await ensureUiUser('editor');
  await seedCatalogSample();
});

test.describe('находка 1 — список после смены временного пароля', () => {
  test('новый сотрудник видит устройства сразу, без F5', async ({ page }) => {
    const pending = await createPendingPasswordUser('viewer');
    await signIn(page, pending.username, pending.temporaryPassword);

    // Форма смены пароля — принудительная, без крестика.
    await expect(page.getByText('Пароль вашей учётной записи задавал не вы')).toBeVisible();
    // Шапка приложения тоже даёт «Сменить пароль» — тем же текстом, поэтому
    // кнопку ищем внутри самой модалки, а не по всей странице.
    const modal = page.getByLabel('Смена пароля');
    await modal.getByLabel('Текущий пароль').fill(pending.temporaryPassword);
    await modal.getByLabel('Новый пароль').nth(0).fill('e2e-novyj-parol-2026');
    await modal.getByLabel('Новый пароль ещё раз').fill('e2e-novyj-parol-2026');
    await modal.getByRole('button', { name: 'Сменить пароль' }).click();
    await page.waitForURL(/\/devices/);

    // Раньше здесь висело «Нет устройств по выбранным условиям» при
    // непустой базе — кэш запросов не сбрасывался вместе со сменой пароля.
    await expect(page.getByText('Нет устройств по выбранным условиям')).toBeHidden();
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});

test.describe('находка 3 — ошибка сервера видна на каждом списке', () => {
  for (const [label, path, heading] of [
    ['Устройства', '/devices', 'Устройства'],
    ['Связи', '/links', 'Связи между портами'],
    ['Теги', '/tags', 'Теги'],
    ['VLAN', '/vlans', 'VLAN'],
  ] as const) {
    test(`500 на ${label} показывает алерт, а не пустую страницу`, async ({ page }) => {
      await signIn(page, editor.username, editor.password);
      await page.waitForURL(/\/devices/);
      await expectNoForcedPasswordModal(page);

      await failRequest(page, path, 500);
      await page.goto(path === '/links' ? '/links' : path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.locator('.mantine-Alert-root')).toBeVisible();
    });
  }
});

test.describe('находки 4, 10 — доступные имена и правка у смотрящего', () => {
  test('на страницах со строками нет кнопок-иконок без доступного имени', async ({ page }) => {
    await signIn(page, editor.username, editor.password);
    await page.waitForURL(/\/devices/);
    await expectNoForcedPasswordModal(page);

    for (const [path, expand] of [
      ['/devices', true],
      ['/links', false],
      ['/catalog', false],
      ['/tags', false],
      ['/vlans', false],
    ] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      if (expand) await page.locator('tbody tr').first().click();
      await page.waitForTimeout(200);
      const count = await iconButtonsWithoutName(page);
      expect(count, `${path}: кнопок-иконок без доступного имени`).toBe(0);
    }
  });

  test('у смотрящего кнопок правки и удаления нет в DOM', async ({ page }) => {
    const viewer = await ensureUiUser('viewer');
    await signIn(page, viewer.username, viewer.password);
    await page.waitForURL(/\/devices/);
    await expectNoForcedPasswordModal(page);

    for (const path of ['/catalog', '/templates'] as const) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const count = await editDeleteButtonsInDom(page);
      expect(count, `${path}: кнопок правки/удаления в DOM у viewer`).toBe(0);
    }
  });
});
