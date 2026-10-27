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
    // Расчёт доставки подгружается после отрисовки — ждём его, чтобы снимок не ловил «Считаем стоимость…»
    ready: async (p) => {
      await expect(p.getByRole('button', { name: 'Добавить в корзину' })).toBeVisible();
      await expect(p.getByText(/^ПВЗ от /)).toBeVisible();
    },
    // Остаток («в наличии: N шт.») и срок акции меняются
    extra: (p) => [p.locator('[class*="product_stock"]'), p.locator('[class*="product_promo"]')],
  },
  { name: 'quiz-step-1', path: '/quiz/1', ready: (p) => expect(p.getByRole('heading', { name: 'Для кого подбираем?' })).toBeVisible() },
  { name: 'premium', path: '/premium', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'how', path: '/how', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
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

    if (size.name === '1549') {
      // Открытое мегаменю «Каталог»: снимаем шапку с панелью (страница под ней затемнена и в снимок не входит)
      test(`catalog-menu @${size.name}`, async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.locator('header').getByRole('link', { name: 'Каталог', exact: true }).click();
        const nav = page.locator('#catalog-menu').getByRole('navigation', { name: 'Каталог' });
        await expect(nav).toBeVisible();
        await settle(page);
        const box = (await page.locator('#catalog-menu > div').boundingBox())!;
        await expect(page).toHaveScreenshot(`catalog-menu-${size.name}.png`, { clip: { x: 0, y: 0, width: size.viewport.width, height: Math.ceil(box.y + box.height) } });
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

/**
 * Админка на 1440 (макета нет — эталон фиксирует общий с кабинетом вид: меню, шапка, карточки, таблицы, пилюли).
 * Снимок — первый экран, без fullPage: число строк в списках меняют другие сценарии. Маскируются тела таблиц
 * с заказами и даты/числа, которые меняются от прогона к прогону.
 */
test.describe('вёрстка админки 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ context, baseURL }) => {
    const password = process.env.E2E_DEMO_PASSWORD;
    if (!password) throw new Error('Задайте E2E_DEMO_PASSWORD (pnpm e2e подставляет его сам)');
    // Вход как в a11y-cabinet.spec: POST /api/auth/login, cookies сессии остаются в контексте
    const ip = `10.250.9.${1 + Math.floor(Math.random() * 250)}`;
    let status = 0;
    for (let i = 0; i < 3 && status !== 200; i++) {
      if (i) await new Promise((r) => setTimeout(r, 3000));
      const res = await context.request.post(`${baseURL}/api/auth/login`, { data: { email: 'demo.admin@example.ru', password }, headers: { 'X-Forwarded-For': ip }, failOnStatusCode: false });
      status = res.status();
    }
    expect(status, 'вход demo.admin не удался').toBe(200);
  });

  const ADMIN: { name: string; path: string; mask: (page: Page) => Locator[] }[] = [
    // Список заказов пополняют сценарии оформления — маскируем строки целиком
    { name: 'admin-orders', path: '/admin/orders', mask: (p) => [p.locator('main tbody')] },
    // Число товаров в категориях зависит от каталога
    { name: 'admin-dictionaries', path: '/admin/dictionaries', mask: (p) => [p.locator('main tbody td:nth-child(4)')] },
    // Последняя активность сотрудников
    { name: 'admin-system', path: '/admin/system', mask: (p) => [p.locator('main tbody td:nth-child(3)')] },
  ];
  for (const a of ADMIN) {
    test(`${a.name} @1440`, async ({ page }) => {
      await page.goto(a.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('main table').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await settle(page);
      await expect(page).toHaveScreenshot(`${a.name}-1440.png`, { mask: a.mask(page) });
    });
  }
});
