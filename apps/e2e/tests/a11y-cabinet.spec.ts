import { randomInt } from 'node:crypto';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { audit, expect, newPassword, register, test, uniqueEmail } from './fixtures';

/**
 * Доступность кабинета поставщика и админки: axe (WCAG 2.1 A/AA, serious/critical) по всем разделам
 * и проверки с клавиатуры — меню, модалка варианта товара, окно рассылки по акции.
 * Вход — демо-аккаунты (пароль из E2E_DEMO_PASSWORD, его подставляет run.mjs); сессия входа одна на группу тестов.
 */

const SUPPLIER = 'demo.msk@example.ru';
const ADMIN = 'demo.admin@example.ru';
type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>;
/** Cookies сессии, полученные при входе в beforeAll группы */
const sessions: Partial<Record<'supplier' | 'admin', Cookies>> = {};

function password() {
  const p = process.env.E2E_DEMO_PASSWORD;
  if (!p) throw new Error('Задайте E2E_DEMO_PASSWORD (pnpm e2e подставляет его сам)');
  return p;
}

/**
 * Вход один раз на группу тестов: POST /api/auth/login (как форма входа) и сохранение cookies сессии.
 * Формы входа проверяются отдельно (a11y.spec, order.spec); API на dev может перезапускаться — до 3 попыток.
 */
async function login(who: 'supplier' | 'admin', browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': `10.250.${who === 'admin' ? 1 : 2}.${randomInt(1, 255)}` } });
  const email = who === 'admin' ? ADMIN : SUPPLIER;
  let status = 0;
  for (let i = 0; i < 3 && status !== 200; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000));
    status = (await ctx.request.post('/api/auth/login', { data: { email, password: password() }, failOnStatusCode: false })).status();
  }
  expect(status, `вход ${email} не удался`).toBe(200);
  sessions[who] = await ctx.cookies();
  await ctx.close();
}

/** Открыть страницу кабинета и дождаться данных: заголовок h1 и тишина в сети (клиентские загрузки завершены). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Адрес первой ссылки из списка, подходящей под шаблон (карточки берём первые из списков). */
async function firstHref(page: Page, list: string, pattern: RegExp, opts: { soft?: boolean } = {}) {
  await open(page, list);
  // Списки грузятся на клиенте (иногда с задержкой поиска) — ждём, пока ссылка появится
  let href: string | undefined;
  const found = expect
    .poll(async () => {
      const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      return (href = hrefs.find((h) => pattern.test(h)));
    }, { message: `в списке ${list} нет ссылки ${pattern}`, timeout: opts.soft ? 3000 : undefined })
    .toBeTruthy();
  if (opts.soft) await found.catch(() => undefined);
  else await found;
  // В мягком режиме — пустая строка, если ссылки нет
  return href ?? '';
}

/**
 * Заказ на демо-стенде нужен для карточек заказа и отправления. Если заказов нет (база только что засеяна) —
 * оформляем один: товар «МедТекс» → регистрация → ПВЗ → тестовая оплата.
 */
async function placeOrder(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': `10.251.${randomInt(1, 255)}.${randomInt(1, 255)}` } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('cookie-consent', 'essential');
    } catch {
      /* about:blank */
    }
  });
  const page = await ctx.newPage();
  await page.goto('/product/kostyum-hirurg-1');
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByRole('link', { name: /Добавлено в корзину/ })).toBeVisible();
  await page.goto('/register?next=/checkout');
  await register(page, uniqueEmail(), newPassword());
  await expect(page).toHaveURL(/\/checkout$/);
  await page.getByRole('button', { name: /^Пункт выдачи СДЭК · \d/ }).first().click();
  const shops = page.getByRole('dialog', { name: 'Пункты выдачи' });
  await shops.getByRole('listbox', { name: 'Пункты выдачи' }).getByRole('option').first().click();
  await shops.getByRole('button', { name: 'Привезти сюда' }).click();
  await expect(shops).toBeHidden();
  await page.getByLabel('Имя и фамилия').fill('Анна Тестова');
  await page.getByLabel('Телефон').fill('+7 999 123-45-67');
  await page.getByRole('button', { name: 'Оплатить', exact: true }).click();
  await page.getByRole('button', { name: /^Перейти к оплате/ }).click();
  await expect(page).toHaveURL(/\/pay\/test\//);
  await page.getByRole('button', { name: /^Оплатить \d/ }).click();
  await expect(page.getByRole('heading', { name: /Заказ\s+оформлен/ })).toBeVisible();
  await ctx.close();
}

/** Ссылка на карточку из списка; список пуст — оформляем заказ и смотрим ещё раз. */
async function orderHref(page: Page, browser: Browser, baseURL: string, list: string, pattern: RegExp) {
  const href = await firstHref(page, list, pattern, { soft: true });
  if (href) return href;
  await placeOrder(browser, baseURL);
  return firstHref(page, list, pattern);
}

/** Фокус внутри модального окна (на поле, кнопке или на самом окне). */
async function expectFocusIn(dialog: Locator) {
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement)), { message: 'фокус вне окна' }).toBe(true);
}

/** Элемент в фокусе виден: есть outline или тень. */
async function expectFocusVisible(el: Locator) {
  const ok = await el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
  });
  expect(ok, 'у элемента в фокусе нет видимого контура').toBe(true);
}

/** Tab по боковому меню: каждый пункт получает фокус по порядку, контур виден; у активного — aria-current. */
async function tabThroughNav(page: Page, nav: Locator) {
  const links = nav.getByRole('link');
  const count = await links.count();
  expect(count).toBeGreaterThan(3);
  await links.first().focus();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    await expect(link).toBeFocused();
    await expectFocusVisible(link);
    if (i < count - 1) await page.keyboard.press('Tab');
  }
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
}

test.describe('кабинет поставщика', () => {
  test.beforeAll(async ({ browser, baseURL }) => login('supplier', browser, baseURL!));
  test.beforeEach(async ({ context }) => context.addCookies(sessions.supplier!));

  const PAGES: [string, string][] = [
    ['дашборд', '/supplier'],
    ['товары', '/supplier/products'],
    ['новый товар', '/supplier/products/new'],
    ['импорт', '/supplier/import'],
    ['заказы', '/supplier/orders'],
    ['контент', '/supplier/content'],
    ['новая статья', '/supplier/content/articles/new'],
    ['настройки', '/supplier/settings'],
    ['акции', '/supplier/promotions'],
    ['выплаты', '/supplier/payouts'],
  ];
  for (const [name, path] of PAGES) {
    test(`axe: ${name}`, async ({ page }) => {
      await open(page, path);
      await audit(page);
    });
  }

  test('axe: карточка товара и окно варианта; клавиатура: окно открывается и закрывается без потери фокуса', async ({ page }) => {
    const href = await firstHref(page, '/supplier/products', /^\/supplier\/products\/(?!new)[^/?]+$/);
    await open(page, href);
    await audit(page);

    // Окно варианта с клавиатуры: Enter на «+ Добавить вариант» → фокус внутри окна → Escape → фокус на кнопке
    const add = page.getByRole('button', { name: '+ Добавить вариант' });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Добавить вариант' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Фокус сразу на первом поле окна
    await expect(dialog.getByRole('textbox').or(dialog.getByRole('combobox')).first()).toBeFocused();
    await audit(page);
    // Tab и Shift+Tab не уводят фокус из окна
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    await expectFocusIn(dialog);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
    await expectFocusIn(dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();

    // Существующий вариант — окно «Изменить вариант», закрытие кнопкой «Закрыть»
    const edit = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Размер-рост' }) }).getByRole('button').first();
    if (await edit.count()) {
      await edit.click();
      const d2 = page.getByRole('dialog', { name: 'Изменить вариант' });
      await expect(d2).toBeVisible();
      await d2.getByRole('button', { name: 'Закрыть' }).click();
      await expect(d2).toBeHidden();
      await expect(edit).toBeFocused();
    }
  });

  test('axe: отправление', async ({ page, browser, baseURL }) => {
    const href = await orderHref(page, browser, baseURL!, '/supplier/orders?status=all', /^\/supplier\/orders\/[^/?]+$/);
    await open(page, href);
    await audit(page);
  });

  test('axe: редактор статьи', async ({ page }) => {
    const href = await firstHref(page, '/supplier/content', /^\/supplier\/content\/articles\/(?!new)[^/?]+$/);
    await open(page, href);
    await audit(page);
  });

  test('axe: уведомления и меню аккаунта в шапке', async ({ page }) => {
    await open(page, '/supplier');
    await page.getByRole('button', { name: /^Уведомления/ }).click();
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toBeVisible();
    await audit(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toBeHidden();
  });

  test('клавиатура: Tab по меню кабинета, фокус виден, активный пункт отмечен', async ({ page }) => {
    await open(page, '/supplier/orders');
    const nav = page.getByRole('navigation', { name: 'Кабинет поставщика' });
    await tabThroughNav(page, nav);
    await expect(nav.getByRole('link', { name: 'Заказы' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('кабинет поставщика: вход и заявка', () => {
  test('axe: заявка на подключение', async ({ page }) => {
    await open(page, '/supplier/apply');
    await audit(page);
  });
});

test.describe('админка', () => {
  test.beforeAll(async ({ browser, baseURL }) => login('admin', browser, baseURL!));
  test.beforeEach(async ({ context }) => context.addCookies(sessions.admin!));

  const PAGES: [string, string][] = [
    ['заявки поставщиков', '/admin'],
    ['модерация товаров', '/admin/moderation'],
    ['модерация контента', '/admin/content'],
    ['справочники', '/admin/dictionaries'],
    ['витрина', '/admin/storefront'],
    ['подбор', '/admin/capsule'],
    ['заказы', '/admin/orders'],
    ['выплаты', '/admin/payouts'],
    ['пользователи', '/admin/users'],
    ['акции', '/admin/promotions'],
    ['журнал редакции', '/admin/editorial'],
    ['юридические страницы', '/admin/legal'],
    ['стилист', '/admin/stylist'],
    ['премиум-заявки', '/admin/premium'],
    ['сотрудники и настройки', '/admin/system'],
    ['безопасность и 2FA', '/admin/security'],
  ];
  for (const [name, path] of PAGES) {
    test(`axe: ${name}`, async ({ page }) => {
      await open(page, path);
      await audit(page);
    });
  }

  test('axe: карточка модерации', async ({ page, browser, baseURL }) => {
    await open(page, '/admin/moderation');
    let href = await page.locator('a[href^="/admin/moderation/"]').first().getAttribute('href', { timeout: 2000 }).catch(() => null);
    if (!href) {
      // Очередь пуста — карточка открывается для любого товара: берём первый товар демо-поставщика
      await login('supplier', browser, baseURL!);
      const ctx = await browser.newContext({ baseURL });
      await ctx.addCookies(sessions.supplier!);
      const list = (await (await ctx.request.get('/api/supplier/products')).json()) as { items: { id: string }[] };
      await ctx.close();
      expect(list.items.length, 'у демо-поставщика нет товаров').toBeGreaterThan(0);
      href = `/admin/moderation/${list.items[0]!.id}`;
    }
    await open(page, href);
    await audit(page);
  });

  test('axe: карточка заказа', async ({ page, browser, baseURL }) => {
    const href = await orderHref(page, browser, baseURL!, '/admin/orders', /^\/admin\/orders\/[^/?]+$/);
    await open(page, href);
    await audit(page);
  });

  const CARDS: [string, string, RegExp][] = [
    ['юридическая страница', '/admin/legal', /^\/admin\/legal\/[^/?]+$/],
    ['статья журнала', '/admin/editorial', /^\/admin\/editorial\/articles\/(?!new)[^/?]+$/],
  ];
  for (const [name, list, re] of CARDS) {
    test(`axe: ${name}`, async ({ page }) => {
      const href = await firstHref(page, list, re);
      await open(page, href);
      await audit(page);
    });
  }

  // Списки стилиста и премиум-заявок на демо-стенде могут быть пустыми — карточку проверяем, если есть
  for (const [name, list, re] of [
    ['заявка стилисту', '/admin/stylist', /^\/admin\/stylist\/[^/?]+$/],
    ['премиум-заявка', '/admin/premium', /^\/admin\/premium\/[^/?]+$/],
  ] as const) {
    test(`axe: ${name}`, async ({ page }) => {
      await open(page, list);
      const link = page.locator(`a[href^="${list}/"]`).first();
      test.skip(!(await link.count()), 'Список пуст');
      await open(page, (await link.getAttribute('href'))!);
      await audit(page);
    });
  }

  test('axe: окно рассылки по акции; клавиатура: открытие, Tab внутри, Escape возвращает фокус', async ({ page }) => {
    await open(page, '/admin/promotions');
    const btn = page.getByRole('button', { name: 'Разослать покупателям' }).first();
    test.skip(!(await btn.count()), 'Нет акции с рассылкой');
    await btn.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expectFocusIn(dialog);
    await page.waitForLoadState('networkidle');
    await audit(page);
    for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
    await expectFocusIn(dialog);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('клавиатура: Tab по меню админки, фокус виден, активный пункт отмечен', async ({ page }) => {
    await open(page, '/admin/orders');
    const nav = page.getByRole('navigation', { name: 'Админка' });
    await tabThroughNav(page, nav);
    await expect(nav.getByRole('link', { name: 'Заказы и платежи' })).toHaveAttribute('aria-current', 'page');
  });
});
