import { audit, expect, newPassword, register, test, uniqueEmail } from './fixtures';

/** Товар второго поставщика (демо: «МедТекс», Москва — кабинет demo.msk@example.ru) */
const MSK_PRODUCT = '/product/kostyum-hirurg-1';
const MSK_SUPPLIER = 'demo.msk@example.ru';

// Номер заказа из первого сценария нужен поставщику во втором — сценарии идут строго по порядку
test.describe.serial('Заказ гостя и подтверждение поставщиком', () => {
  let orderNumber = '';

  test('гость: каталог → фильтр → товар → корзина → регистрация → оформление → оплата → заказ в профиле', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Главная → каталог
    await page.getByRole('banner').getByRole('link', { name: 'Каталог', exact: true }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole('heading', { level: 1, name: /Медицинская одежда/ })).toBeVisible();

    // Фильтр по бренду поставщика из Санкт-Петербурга («Форма+»)
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await sheet.getByRole('button', { name: 'Форма+', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Форма+', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: /^Показать \d+/ }).click();
    await expect(page).toHaveURL(/brand=/);
    await expect(page.getByRole('button', { name: /^Фильтры\s*1/ })).toBeVisible();

    // Товар → в корзину
    await page.locator('main a[href^="/product/"]').first().click();
    await expect(page).toHaveURL(/\/product\//);
    await page.getByRole('button', { name: 'Добавить в корзину' }).click();
    await expect(page.getByRole('link', { name: /Добавлено в корзину/ })).toBeVisible();

    // Второй товар — от другого поставщика, чтобы в заказе было два отправления
    await page.goto(MSK_PRODUCT);
    await page.getByRole('button', { name: 'Добавить в корзину' }).click();
    await expect(page.getByRole('link', { name: /Добавлено в корзину/ })).toBeVisible();

    await page.getByRole('link', { name: 'Корзина' }).first().click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByText(/Придёт 2 отправлениями/)).toBeVisible();
    await audit(page);

    // Оформление гостем → вход → «Создать аккаунт»
    await page.getByRole('link', { name: 'Перейти к оформлению' }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fcheckout|\/login\?next=\/checkout/);
    await page.getByRole('link', { name: 'Создать аккаунт' }).click();
    await expect(page).toHaveURL(/\/register/);
    const email = uniqueEmail();
    await register(page, email, newPassword());
    await expect(page).toHaveURL(/\/checkout$/);

    // Отправление 1 — пункт выдачи
    await expect(page.getByText(/^Отправление 1 ·/)).toBeVisible();
    await expect(page.getByText(/^Отправление 2 ·/)).toBeVisible();
    await page.getByRole('button', { name: /^Пункт выдачи СДЭК · \d/ }).first().click();
    const shops = page.getByRole('dialog', { name: 'Пункты выдачи' });
    await shops.getByRole('listbox', { name: 'Пункты выдачи' }).getByRole('option').first().click();
    await expect(shops.getByText(/Стоимость — \d/)).toBeVisible();
    await shops.getByRole('button', { name: 'Привезти сюда' }).click();
    await expect(shops).toBeHidden();
    await expect(page.getByRole('button', { name: /^Пункт выдачи СДЭК доставка/ })).toBeVisible();

    // Отправление 2 — курьер: новый адрес, затем «Привезти сюда»
    await page.getByRole('button', { name: /^Курьер СДЭК · \d/ }).last().click();
    const drawer = page.getByRole('dialog', { name: 'Адрес доставки' });
    await expect(drawer.getByLabel('Город')).toHaveValue('Москва');
    await drawer.getByLabel('Улица и дом').fill('ул. Тверская, д. 1');
    await drawer.getByLabel('Кв./офис').fill('10');
    await drawer.getByRole('button', { name: 'Сохранить' }).click();
    await expect(drawer.getByRole('radio', { checked: true })).toContainText('ул. Тверская, д. 1');
    await drawer.getByRole('button', { name: 'Привезти сюда' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('button', { name: /^Курьер СДЭК доставка/ })).toBeVisible();

    // Получатель
    await page.getByLabel('Имя и фамилия').fill('Анна Тестова');
    await page.getByLabel('Телефон').fill('+7 999 123-45-67');
    await expect(page.getByLabel('Email')).toHaveValue(email);
    await page.getByRole('button', { name: 'Оплатить', exact: true }).click();

    // Шаг «Оплата» → тестовая страница платёжки
    await expect(page.getByRole('heading', { name: 'Оплата' })).toBeVisible();
    await expect(page.getByText('2 отправления')).toBeVisible();
    await audit(page);
    await page.getByRole('button', { name: /^Перейти к оплате/ }).click();
    await expect(page).toHaveURL(/\/pay\/test\//);
    await page.getByRole('button', { name: /^Оплатить \d/ }).click();

    // «Заказ оформлен»
    await expect(page.getByRole('heading', { name: /Заказ\s+оформлен/ })).toBeVisible();
    await audit(page);
    const eyebrow = await page.getByText(/^Заказ № /).textContent();
    orderNumber = eyebrow!.replace('Заказ № ', '').trim();
    expect(orderNumber).not.toBe('');

    // Заказ в профиле
    await page.goto('/account');
    await expect(page.getByRole('link', { name: new RegExp(`№ ${orderNumber}`) })).toBeVisible();
  });

  test('поставщик: вход → заказы → подтверждение отправления из первого сценария', async ({ page }) => {
    test.skip(!orderNumber, 'Нет заказа из предыдущего сценария');
    const password = process.env.E2E_DEMO_PASSWORD;
    if (!password) throw new Error('Задайте E2E_DEMO_PASSWORD (pnpm e2e подставляет его сам)');

    await page.goto('/supplier/login');
    await page.getByLabel('Email').fill(MSK_SUPPLIER);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти в кабинет' }).click();
    await expect(page).toHaveURL(/\/supplier$/);

    await page.goto('/supplier/orders');
    await expect(page.getByRole('heading', { name: 'Заказы', level: 1 })).toBeVisible();
    await page.getByLabel('Поиск по номеру или клиенту').fill(orderNumber);
    // У поставщика номер отправления — номер заказа с суффиксом
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: new RegExp(orderNumber) }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Новый · оплачен')).toBeVisible();
    await audit(page);
    await row.getByRole('button', { name: 'Подтвердить' }).click();
    // Подтверждённое отправление ждёт следующего шага — «Упаковано»
    await expect(row.getByText('Подтверждён')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Упаковано' })).toBeVisible();
  });
});
