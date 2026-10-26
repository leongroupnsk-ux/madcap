import { defineConfig, devices } from '@playwright/test';

/**
 * Браузерные e2e-тесты против запущенного dev-стенда (web :4000, API :4100 на базе с демо-данными).
 * Запуск — `pnpm e2e` из корня (скрипт run.mjs подставляет пароль демо-поставщика).
 */
export default defineConfig({
  testDir: './tests',
  // Сценарии создают заказы и пользователей на общем стенде — гоняем по одному, без гонок за остатки
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // Первая сборка страницы в next dev может занимать десятки секунд
  timeout: 120_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      // Шрифтовой антиалиасинг даёт единичные пиксели — допускаем до 1% площади
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
      // Значок Next.js dev-режима и оверлеи не входят в вёрстку
      stylePath: './tests/screenshot.css',
    },
  },
  // Эталоны без суффикса платформы — одни на репозиторий (сняты на macOS; на другой ОС шрифты рисуются иначе — см. README, «Тесты»)
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4000',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1549, height: 1000 } },
    },
  ],
});
