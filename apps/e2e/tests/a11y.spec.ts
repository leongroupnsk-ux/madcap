import type { Page } from '@playwright/test';
import { audit, expect, newPassword, register, test, uniqueEmail } from './fixtures';

/** Товар для проверок страницы товара (демо-каталог) */
const PRODUCT = '/product/halat-zhenskiy-klassika-3';

const PAGES: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'главная', path: '/', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'каталог', path: '/catalog', ready: (p) => expect(p.locator('main a[href^="/product/"]').first()).toBeVisible() },
  { name: 'товар', path: PRODUCT, ready: (p) => expect(p.getByRole('button', { name: 'Добавить в корзину' })).toBeVisible() },
  { name: 'корзина (пустая)', path: '/cart', ready: (p) => expect(p.getByText('В корзине пока пусто.')).toBeVisible() },
  { name: 'анкета, шаг 1', path: '/quiz/1', ready: (p) => expect(p.getByRole('heading', { name: 'Для кого подбираем?' })).toBeVisible() },
  { name: 'премиум', path: '/premium', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'вход', path: '/login', ready: (p) => expect(p.getByRole('button', { name: 'Войти' })).toBeVisible() },
  { name: 'регистрация', path: '/register', ready: (p) => expect(p.getByRole('button', { name: 'Создать аккаунт' })).toBeVisible() },
  { name: 'журнал', path: '/journal', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'вход поставщика', path: '/supplier/login', ready: (p) => expect(p.getByRole('button', { name: 'Войти в кабинет' })).toBeVisible() },
];

for (const p of PAGES) {
  test(`axe: ${p.name}`, async ({ page }) => {
    await page.goto(p.path);
    await p.ready(page);
    await audit(page);
  });
}

test('axe: корзина с товаром, фильтры каталога, cookie-баннер', async ({ page }) => {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.getByRole('link', { name: /Добавлено в корзину/ }).click();
  await expect(page.getByRole('link', { name: 'Перейти к оформлению' })).toBeVisible();
  await audit(page);

  await page.goto('/catalog');
  await page.getByRole('button', { name: /^Фильтры/ }).click();
  await expect(page.getByRole('dialog', { name: 'Фильтры' })).toBeVisible();
  await audit(page);
});

test('axe: оформление (отправление, окно ПВЗ, адрес курьера) и профиль покупателя', async ({ page }) => {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await expect(page.getByRole('link', { name: /Добавлено в корзину/ })).toBeVisible();
  await page.goto('/register?next=/checkout');
  await register(page, uniqueEmail(), newPassword());
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText(/^Отправление 1 ·/)).toBeVisible();
  await audit(page);

  await page.getByRole('button', { name: /^Пункт выдачи СДЭК · \d/ }).click();
  const shops = page.getByRole('dialog', { name: 'Пункты выдачи' });
  await expect(shops.getByRole('option').first()).toBeVisible();
  await audit(page);
  await shops.getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('button', { name: /^Курьер СДЭК · \d/ }).click();
  await expect(page.getByRole('dialog', { name: 'Адрес доставки' }).getByLabel('Улица и дом')).toBeVisible();
  await audit(page);
  await page.keyboard.press('Escape');

  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await audit(page);
});

test.describe('баннер', () => {
  test.use({ acceptCookies: false });
  test('axe: cookie-баннер', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Cookies' })).toBeVisible();
    await audit(page);
  });
});

test('клавиатура: с главной Tab ведёт по ссылкам шапки, фокус виден', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const first = page.locator(':focus');
  await expect(first).toHaveAttribute('href', '/');
  // Видимый индикатор фокуса: outline или тень
  const visible = await first.evaluate((el) => {
    const cs = getComputedStyle(el);
    return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
  });
  expect(visible, 'у элемента в фокусе нет видимого контура').toBe(true);
});
