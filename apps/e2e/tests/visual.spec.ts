import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Скриншотные тесты вёрстки (эталоны — tests/__screenshots__/visual.spec.ts/*.png).
 * Обновить эталоны после намеренной правки вёрстки: `pnpm e2e tests/visual.spec.ts --update-snapshots`.
 *
 * Динамичное маскируется: карточки товаров (порядок «Хитов» и выдачи зависит от продаж и остатков —
 * их меняют сами e2e-заказы), остатки и сроки акций на странице товара, год в подвале.
 */

/** Товар без акции, который не покупают другие сценарии */
const PRODUCT = '/product/bluza-komfort-24';

const SIZES = [
  { name: '1549', viewport: { width: 1549, height: 1000 } },
  { name: '360', viewport: { width: 360, height: 780 } },
] as const;

/** Все картинки — сразу и полностью загружены, шрифты готовы: снимок не зависит от ленивой подгрузки. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll('img')) img.loading = 'eager';
    await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await document.fonts.ready;
  });
  // Курсор не должен давать hover-состояния
  await page.mouse.move(0, 0);
}

const masks = (page: Page): Locator[] => [
  page.locator('main a[href^="/product/"]'),
  page.locator('[class*="footerLegal"]'),
];

const PAGES: { name: string; path: string; ready: (page: Page) => Promise<void>; extra?: (page: Page) => Locator[] }[] = [
  { name: 'home', path: '/', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'catalog', path: '/catalog', ready: (p) => expect(p.locator('main a[href^="/product/"]').first()).toBeVisible() },
  {
    name: 'product',
    path: PRODUCT,
    ready: (p) => expect(p.getByRole('button', { name: 'Добавить в корзину' })).toBeVisible(),
    // Остаток («в наличии: N шт.») и срок акции меняются
    extra: (p) => [p.locator('[class*="product_stock"]'), p.locator('[class*="product_promo"]')],
  },
  { name: 'quiz-step-1', path: '/quiz/1', ready: (p) => expect(p.getByRole('heading', { name: 'Для кого подбираем?' })).toBeVisible() },
  { name: 'premium', path: '/premium', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
];

for (const size of SIZES) {
  test.describe(`вёрстка ${size.name}`, () => {
    test.use({ viewport: size.viewport });

    for (const p of PAGES) {
      test(`${p.name} @${size.name}`, async ({ page }) => {
        await page.goto(p.path);
        await p.ready(page);
        await settle(page);
        await expect(page).toHaveScreenshot(`${p.name}-${size.name}.png`, { fullPage: true, mask: [...masks(page), ...(p.extra?.(page) ?? [])] });
      });
    }

    test(`cart @${size.name}`, async ({ page }) => {
      await page.goto(PRODUCT);
      await page.getByRole('button', { name: 'Добавить в корзину' }).click();
      await page.getByRole('link', { name: /Добавлено в корзину/ }).click();
      await expect(page.getByRole('link', { name: 'Перейти к оформлению' })).toBeVisible();
      await expect(page.locator('main img').first()).toBeVisible();
      await settle(page);
      // Товар в корзине фиксированный — карточку не маскируем, только год в подвале
      await expect(page).toHaveScreenshot(`cart-${size.name}.png`, { fullPage: true, mask: [page.locator('[class*="footerLegal"]')] });
    });
  });
}
