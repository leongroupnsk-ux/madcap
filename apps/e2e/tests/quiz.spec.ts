import { audit, expect, newPassword, register, test, uniqueEmail } from './fixtures';

test('анкета 1–6 → проверка → капсула из 5 вещей → замена → «Добавить капсулу» в корзину', async ({ page }) => {
  const next = () => page.getByRole('button', { name: 'Далее →' }).click();

  // Шаг 1 — пол, имя, возраст; без ответов дальше не пускает
  await page.goto('/quiz/1');
  await expect(page.getByRole('heading', { level: 1, name: 'Для кого подбираем?' })).toBeVisible();
  await next();
  await expect(page.getByText('Выберите вариант')).toBeVisible();
  await page.getByRole('group', { name: 'Для кого подбираем' }).getByRole('button', { name: 'Женский' }).click();
  await page.getByLabel('Имя').fill('Анна');
  await page.getByLabel('Возраст').fill('30');
  await next();

  // Шаг 2 — параметры и размеры
  await expect(page).toHaveURL(/\/quiz\/2$/);
  await expect(page.getByText('2 из 6')).toBeVisible();
  await page.getByLabel('Рост, см').fill('168');
  await page.getByLabel('Вес, кг').fill('60');
  await page.getByLabel('Размер верха').selectOption('M');
  await page.getByLabel('Размер низа').selectOption('M');
  await page.getByLabel('Размер обуви').selectOption('38');
  await next();

  // Шаг 3 — цветотип
  await expect(page).toHaveURL(/\/quiz\/3$/);
  await page.getByRole('group', { name: 'Тон кожи' }).getByRole('button', { name: 'Тёплый' }).click();
  await page.getByRole('group', { name: 'Цвет волос' }).getByRole('button', { name: 'Тёмные' }).click();
  await page.getByRole('group', { name: 'Цвет глаз' }).getByRole('button', { name: 'Тёмные' }).click();
  await expect(page.getByText(/Ваш цветотип:/)).toBeVisible();
  await next();

  // Шаг 4 — специальность через поиск
  await expect(page).toHaveURL(/\/quiz\/4$/);
  await page.getByLabel('Поиск специальности').fill('хирург');
  await page.getByRole('checkbox').first().check();
  await next();

  // Шаг 5 — бюджет (самый свободный, чтобы капсула собралась целиком)
  await expect(page).toHaveURL(/\/quiz\/5$/);
  await page.getByRole('radiogroup', { name: 'Бюджет на капсулу' }).getByRole('radio').last().click();
  await next();

  // Шаг 6 — фото пропускаем
  await expect(page).toHaveURL(/\/quiz\/6$/);
  await page.getByRole('button', { name: 'Пропустить' }).click();

  // Проверка ответов → аккаунт → профиль готов
  await expect(page).toHaveURL(/\/quiz\/review$/);
  await expect(page.getByRole('heading', { name: 'Всё выглядит верно?' })).toBeVisible();
  await expect(page.getByText('Анна · Женский · 30 лет')).toBeVisible();
  await expect(page.getByText('Верх: M · Низ: M · Обувь: 38')).toBeVisible();
  await audit(page);
  await page.getByRole('button', { name: 'Создать аккаунт и профиль →' }).click();
  await expect(page).toHaveURL(/\/register\?next=/);
  await register(page, uniqueEmail(), newPassword());
  await expect(page).toHaveURL(/\/quiz\/review$/);
  // Ответы гостя перенеслись в профиль
  await expect(page.getByText('Анна · Женский · 30 лет')).toBeVisible();
  await page.getByRole('button', { name: 'Создать мой профиль →' }).click();
  await expect(page.getByRole('heading', { name: 'Ваш персональный профиль готов' })).toBeVisible();
  await page.getByRole('link', { name: /Посмотреть капсулу/ }).click();

  // Капсула: 5 слотов, в каждом вещь
  await expect(page).toHaveURL(/\/capsule$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ваши вещи работают вместе.' })).toBeVisible();
  const cards = page.locator('main article');
  await expect(cards).toHaveCount(5);
  for (const card of await cards.all()) await expect(card.getByRole('link', { name: /^Открыть / })).toBeVisible();
  await expect(page.getByText(/^5 вещей$/)).toBeVisible();
  await audit(page);

  // Замена вещи в первом слоте, где есть альтернативы
  const slot = cards.filter({ has: page.getByRole('button', { name: '↻ Заменить' }) }).first();
  await slot.getByRole('button', { name: '↻ Заменить' }).click();
  const dialog = page.getByRole('dialog', { name: /^Заменить / });
  await expect(dialog).toBeVisible();
  await audit(page);
  // Выбранная альтернатива встаёт в капсулу
  const alt = dialog.locator('article').first();
  const altName = (await alt.locator('span').nth(1).textContent())!.trim();
  await alt.getByRole('button', { name: 'Выбрать' }).click();
  await expect(dialog).toBeHidden();
  await expect(cards).toHaveCount(5);
  await expect(page.locator('main article').filter({ hasText: altName })).toHaveCount(1);

  // Вся капсула — в корзину отдельной группой
  await page.getByRole('button', { name: 'Добавить капсулу' }).click();
  await page.getByRole('link', { name: /В корзине · перейти/ }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText('Персональная капсула')).toBeVisible();
  await expect(page.getByText(/^Товары · 5$/)).toBeVisible();
});
