import { expect, test } from './fixtures';

/**
 * Яндекс Метрика: на стенде без METRIKA_ID счётчика нет — даже при согласии на все cookie
 * ни tag.js, ни запросов к доменам Метрики. CSP уже разрешает домены Метрики (на случай ключа).
 */
test.use({ acceptCookies: false });

test('без METRIKA_ID и с согласием «Разрешить все» — запросов к Метрике нет', async ({ page }) => {
  const metrika: string[] = [];
  page.on('request', (r) => {
    if (/mc\.yandex\.(ru|com)|metrika|tag\.js/.test(r.url())) metrika.push(r.url());
  });
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toContain('https://mc.yandex.ru');
  expect((await page.request.get('/api/public-config')).ok()).toBe(true);
  await page.getByRole('button', { name: 'Разрешить все' }).click();
  await expect(page.getByRole('region', { name: 'Cookies' })).toBeHidden();
  // Переход внутри сайта и страница товара — счётчик так и не появляется
  await page.goto('/catalog');
  await expect(page.locator('main a[href^="/product/"]').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => typeof (window as { ym?: unknown }).ym)).toBe('undefined');
  expect(metrika).toEqual([]);
});
