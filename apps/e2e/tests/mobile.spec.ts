import { expect, expectNoHorizontalScroll, test } from './fixtures';

test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

test('мобильный 360×780: главная, каталог, товар, корзина — без горизонтальной прокрутки', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto('/catalog');
  await expect(page.getByRole('heading', { level: 1, name: /Медицинская одежда/ })).toBeVisible();
  await expect(page.locator('main a[href^="/product/"]').first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Панель фильтров помещается в экран
  await page.getByRole('button', { name: /^Фильтры/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Фильтры' });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await page.locator('main a[href^="/product/"]').first().click();
  await expect(page).toHaveURL(/\/product\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.getByRole('link', { name: /Добавлено в корзину/ }).click();

  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Почти у вас.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Перейти к оформлению' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe('cookie-баннер', () => {
  test.use({ acceptCookies: false });

  test('на 360 px помещается в экран и закрывается', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Cookies' });
    await expect(banner).toBeVisible();
    await expectNoHorizontalScroll(page);
    await banner.getByRole('button', { name: 'Только необходимые' }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(banner).toBeHidden();
  });
});
