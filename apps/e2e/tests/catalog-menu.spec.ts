import type { Page } from '@playwright/test';
import { audit, expect, expectNoHorizontalScroll, test } from './fixtures';

/**
 * Мегаменю «Каталог» в шапке (components/CatalogMenu.tsx, панель — CatalogMenuPanel.tsx, грузится лениво).
 * Скриншот открытого меню — в visual.spec.ts.
 */

const catalogBtn = (page: Page) => page.locator('header').getByRole('link', { name: 'Каталог', exact: true });
const panel = (page: Page) => page.locator('#catalog-menu');

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Ждём гидратацию шапки: до неё клик — обычный переход по ссылке
  await page.waitForLoadState('networkidle');
}

test('мегаменю: клавиатура — Enter открывает, Tab идёт по разделам и подразделам, Escape закрывает и возвращает фокус', async ({ page }) => {
  await openHome(page);
  const btn = catalogBtn(page);
  await expect(btn).toHaveAttribute('href', '/catalog');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(btn).toHaveAttribute('aria-controls', 'catalog-menu');

  // Tab с начала страницы: логотип → «Каталог»
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(btn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(/\/$/);
  const nav = panel(page).getByRole('navigation', { name: 'Каталог' });
  await expect(nav).toBeVisible();

  // Фокус из кнопки сразу уходит в панель: первый раздел → «все товары» этого раздела → следующий раздел
  const first = nav.getByRole('link').first();
  const firstName = (await first.textContent())!.trim();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText(`Все товары раздела «${firstName}» →`);
  await page.keyboard.press('Tab');
  const focusedCat = page.locator(':focus');
  const secondName = (await focusedCat.textContent())!.trim();
  await expect(focusedCat).toHaveAttribute('href', /^\/catalog\/[\w-]+$/);
  // Подразделы видны у раздела в фокусе
  await expect(nav.getByRole('link', { name: `Все товары раздела «${secondName}» →` })).toBeVisible();
  await expect(nav.getByRole('link', { name: `Все товары раздела «${firstName}» →` })).toBeHidden();

  // Раздел с подразделами: Tab доходит до подраздела
  const withChildren = nav.locator('li:has(ul) > div > a').first();
  await withChildren.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('href', /^\/catalog\/[\w-]+$/);
  await expect(page.locator(':focus')).toBeVisible();

  // Колонка «Подбор» тоже достижима с клавиатуры
  await expect(nav.getByRole('link', { name: /Подобрать капсулу/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Распродажа/ })).toHaveAttribute('href', '/catalog?sale=1');
  await expect(nav.getByRole('link', { name: /Премиум/ })).toHaveAttribute('href', '/premium');

  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).toBeHidden();
  await expect(btn).toBeFocused();
});

test('мегаменю: закрывается кликом вне и переходом, открывается наведением', async ({ page }) => {
  await openHome(page);
  const btn = catalogBtn(page);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  // Пустое поле страницы слева под панелью (не ссылка)
  await page.mouse.click(20, 700);
  await expect(page).toHaveURL(/\/$/);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');

  // Наведение на десктопе открывает с задержкой
  await btn.hover();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const nav = panel(page).getByRole('navigation', { name: 'Каталог' });
  await nav.getByRole('link', { name: /Распродажа/ }).click();
  await expect(page).toHaveURL(/\/catalog\?sale=1$/);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('axe: открытое мегаменю (десктоп)', async ({ page }) => {
  await openHome(page);
  await catalogBtn(page).click();
  await expect(panel(page).getByRole('navigation', { name: 'Каталог' })).toBeVisible();
  await audit(page);
});

test.describe('телефон', () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  test('мегаменю на 360 px: полноэкранная панель, аккордеон, axe, закрытие с возвратом фокуса', async ({ page }) => {
    await openHome(page);
    const btn = catalogBtn(page);
    await btn.click();
    const close = page.getByRole('button', { name: 'Закрыть каталог' });
    await expect(close).toBeFocused();
    const box = await panel(page).locator(':scope > div').boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 360 });
    expect(box!.height).toBeGreaterThanOrEqual(780);
    await expectNoHorizontalScroll(page);

    // Аккордеон: подразделы скрыты до раскрытия
    const toggle = panel(page).getByRole('button', { name: /^Подразделы: / }).first();
    const sub = panel(page).locator(`#${await toggle.getAttribute('aria-controls')}`);
    await expect(sub).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sub).toBeVisible();
    await audit(page);

    await close.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();
  });
});

test.describe('без JS', () => {
  test.use({ javaScriptEnabled: false });

  test('«Каталог» — обычная ссылка на /catalog', async ({ page }) => {
    await page.goto('/');
    await catalogBtn(page).click();
    await expect(page).toHaveURL(/\/catalog$/);
  });
});
