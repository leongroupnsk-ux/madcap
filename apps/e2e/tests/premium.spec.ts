import { audit, expect, test } from './fixtures';

test('премиум: лендинг → анкета 7 шагов → капсула → заявка с проверкой телефона → подтверждение', async ({ page }) => {
  const next = () => page.getByRole('button', { name: 'Далее →' }).click();

  await page.goto('/premium');
  await expect(page.getByRole('heading', { level: 1, name: /кому не все равно/ })).toBeVisible();
  await page.getByRole('link', { name: /подобрать капсулу/ }).first().click();

  // 1 — для кого
  await expect(page).toHaveURL(/\/premium\/quiz\/1$/);
  await page.getByRole('group', { name: 'Для кого подбираем' }).getByRole('button', { name: 'Женский' }).click();
  await page.getByLabel('Имя').fill('Мария');
  await page.getByLabel('Возраст').fill('35');
  await next();

  // 2 — параметры
  await expect(page).toHaveURL(/\/premium\/quiz\/2$/);
  await page.getByLabel('Рост, см').fill('170');
  await page.getByLabel('Размер верха').selectOption('M');
  await page.getByLabel('Размер низа').selectOption('M');
  await next();

  // 3 — цветотип можно пропустить
  await expect(page).toHaveURL(/\/premium\/quiz\/3$/);
  await page.getByRole('button', { name: 'Пропустить' }).click();

  // 4 — где работаете: первая группа
  await expect(page).toHaveURL(/\/premium\/quiz\/4$/);
  // Карточки групп — кнопки-переключатели (aria-pressed)
  const group = page.locator('button[aria-pressed]').first();
  await group.click();
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await next();

  // 5 — бюджет
  await expect(page).toHaveURL(/\/premium\/quiz\/5$/);
  await page.getByRole('radiogroup', { name: 'Бюджет на капсулу' }).getByRole('radio', { name: 'Более 30 000 ₽' }).click();
  await next();

  // 6 — фото (гостю недоступны) → пропустить
  await expect(page).toHaveURL(/\/premium\/quiz\/6$/);
  await page.getByRole('button', { name: 'Пропустить' }).click();

  // 7 — проверка
  await expect(page).toHaveURL(/\/premium\/quiz\/7$/);
  await expect(page.getByRole('heading', { name: 'Всё выглядит верно?' })).toBeVisible();
  await expect(page.getByText('Мария · Женский · 35 лет')).toBeVisible();
  await audit(page);
  await page.getByRole('button', { name: 'Создать мой профиль →' }).click();
  await expect(page.getByRole('heading', { name: 'Ваш персональный профиль готов' })).toBeVisible();
  await page.getByRole('link', { name: 'подобрать капсулу' }).click();

  // Капсула из премиальной коллекции
  await expect(page).toHaveURL(/\/premium\/capsule$/);
  await expect(page.getByRole('link', { name: /— карточка товара$/ }).first()).toBeVisible();
  await audit(page);
  await page.getByRole('button', { name: 'оставить заявку' }).click();

  // Заявка: телефон проверяется до отправки
  const dialog = page.getByRole('dialog', { name: 'Оставьте контакты' });
  await expect(dialog.getByLabel('Ваше имя *')).toHaveValue('Мария');
  await dialog.getByLabel('Телефон *').fill('12345');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(dialog.getByText('Телефон в формате +7 (999) 123-45-67')).toBeVisible();
  await expect(dialog.getByLabel('Телефон *')).toHaveAttribute('aria-invalid', 'true');
  await audit(page);

  // Маска приводит ввод к +7 (999) 123-45-67
  await dialog.getByLabel('Телефон *').fill('89991234567');
  await expect(dialog.getByLabel('Телефон *')).toHaveValue('+7 (999) 123-45-67');
  await dialog.getByRole('radio', { name: 'WhatsApp' }).check();
  await dialog.getByRole('button', { name: 'Отправить заявку' }).click();

  await expect(dialog.getByRole('status')).toContainText('Заявка отправлена');
  await expect(dialog.getByRole('status')).toContainText('в WhatsApp');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
});
