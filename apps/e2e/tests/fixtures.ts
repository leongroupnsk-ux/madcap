import { randomBytes, randomInt } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

/** Уникальный email тестового покупателя: e2e-<время>-<случайное>@example.ru */
export const uniqueEmail = () => `e2e-${Date.now()}-${randomBytes(3).toString('hex')}@example.ru`;

/** Сгенерированный пароль (в лог не пишется). */
export const newPassword = () => `E2e-${randomBytes(12).toString('base64url')}9`;

type Options = {
  /** Сразу закрыть cookie-баннер (выбор «только необходимые») — по умолчанию да */
  acceptCookies: boolean;
};

/**
 * Общие настройки тестов:
 * - у каждого теста свой адрес клиента в X-Forwarded-For: API доверяет прокси Next.js на loopback и считает
 *   лимиты регистрации/входа по IP, так повторные прогоны не упираются в «10 регистраций в час»;
 * - cookie-баннер закрыт заранее, чтобы не перекрывал кнопки внизу экрана (сам баннер проверяется отдельно).
 */
export const test = base.extend<Options>({
  acceptCookies: [true, { option: true }],
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'X-Forwarded-For': `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}` });
  },
  page: async ({ page, acceptCookies }, use) => {
    if (acceptCookies) {
      await page.addInitScript(() => {
        try {
          if (!localStorage.getItem('cookie-consent')) localStorage.setItem('cookie-consent', 'essential');
        } catch {
          /* about:blank */
        }
      });
    }
    await use(page);
  },
});

export { expect };

/** Регистрация на открытой странице /register: email, пароль дважды, согласие. */
export async function register(page: Page, email: string, password: string) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите пароль').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
}

/** Нет горизонтальной прокрутки страницы. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client, culprits } = await page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    // Для сообщения об ошибке — какие элементы вылезают за правый край
    const culprits = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > client + 0.5)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(el.getBoundingClientRect().right)}px`);
    return { scroll: document.documentElement.scrollWidth, client, culprits };
  });
  expect(scroll, `ширина документа больше окна — есть горизонтальная прокрутка: ${culprits.join('; ')}`).toBeLessThanOrEqual(client);
}

/** Проверка axe по WCAG 2.1 A/AA; тест падает на нарушениях уровня serious и critical. */
export async function audit(page: Page) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Значок и оверлей Next.js dev-режима — не часть сайта
    .exclude('nextjs-portal')
    .analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad
    .map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `   ${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1, 2).join('')}`).join('\n')}`)
    .join('\n');
  expect(bad.length, `нарушения доступности:\n${report}`).toBe(0);
}
