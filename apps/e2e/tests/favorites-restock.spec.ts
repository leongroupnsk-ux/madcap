import { audit, expect, newPassword, register, test, uniqueEmail } from './fixtures';

/**
 * Избранное и «Сообщить о поступлении» (демо: у «Халата «Классика»» размер XXL без остатка — apps/api/prisma/demo.ts).
 * Сценарии создают гостевые подписки и покупателей e2e-<время>@example.ru в dev-базе.
 */
const GOWN = '/product/halat-klassika-28';
const GOWN_TITLE = 'Халат «Классика»';

test('избранное гостя: сердечко на товаре → страница «Избранное» → перенос в аккаунт при регистрации → удаление', async ({ page }) => {
  await page.goto(GOWN);
  const heart = page.getByRole('button', { name: `Добавить «${GOWN_TITLE}» в избранное` });
  await heart.click();
  await expect(page.getByRole('button', { name: `Убрать «${GOWN_TITLE}» из избранного` })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/account/favorites');
  await expect(page.getByRole('heading', { name: 'Избранное', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: GOWN_TITLE })).toBeVisible();
  await audit(page);

  // Регистрация: избранное гостя переносится в аккаунт
  await page.goto('/register');
  await register(page, uniqueEmail(), newPassword());
  await expect(page).toHaveURL(/\/account/);
  await expect
    .poll(async () => (await page.request.get('/api/me/favorites')).json().then((b: { items: { title: string }[] }) => b.items.map((i) => i.title)))
    .toContain(GOWN_TITLE);

  // В профиле — пункт «Избранное»
  await page.getByRole('link', { name: 'Открыть избранное →' }).click();
  await expect(page).toHaveURL(/\/account\/favorites$/);
  await page.getByRole('button', { name: `Убрать «${GOWN_TITLE}» из избранного` }).click();
  await expect(page.getByText(/В избранном пока пусто/)).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/me/favorites')).json().then((b: { ids: string[] }) => b.ids.length)).toBe(0);
});

test('«Сообщить о поступлении»: у варианта без остатка вместо «В корзину»; гость подписывается с email и согласием', async ({ page }) => {
  await page.goto(GOWN);
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeVisible();
  await page.getByRole('button', { name: 'XXL — нет в наличии' }).click();
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сообщить о поступлении' }).click();

  await page.getByLabel('Email для уведомления').fill(uniqueEmail());
  // Без согласия не отправить
  await page.getByRole('button', { name: 'Подписаться' }).click();
  await expect(page.getByRole('button', { name: 'Подписаться' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Согласен на обработку email/ }).check();
  await audit(page);
  await page.getByRole('button', { name: 'Подписаться' }).click();
  await expect(page.getByText('✓ Сообщим о поступлении')).toBeVisible();
  await expect(page.getByText(/Пришлём письмо на e\*\*\*@example\.ru/)).toBeVisible();

  // Размер в наличии — снова «В корзину»
  await page.getByRole('button', { name: 'XL', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить в корзину' })).toBeVisible();
});
