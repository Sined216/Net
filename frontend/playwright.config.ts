import { defineConfig, devices } from '@playwright/test';

/** Адрес API. Тесты сами наполняют базу через него — отдельного скрипта
 * с фикстурами не нужно. */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000';

export default defineConfig({
  testDir: './e2e',
  // Сценарии дожидаются медленных ответов намеренно, поэтому лимит выше обычного.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Обычно браузер ставит сам Playwright (`npx playwright install
        // chromium`), как и делает CI. Переменная нужна там, где Chromium
        // уже стоит в системе и качать его повторно незачем.
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {},
      },
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
