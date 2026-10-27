/**
 * Реестр писем системы. Каждое письмо — ключ, группа, описание, переменные с подсказками и текст по умолчанию.
 * В админке («Сотрудники и настройки» → «Шаблоны писем») владелец может переопределить тему и текст:
 * обычный текст с подстановками {{order.number}}, без HTML и без логики — условные куски и списки
 * (позиции заказа, товары акции) приходят готовым текстом в одной переменной.
 *
 * Глобальные переменные {{brand}} и {{site}} доступны во всех шаблонах.
 * Обязательные переменные (ссылка подтверждения, отписка в рассылке) из текста удалить нельзя.
 */

type Def = {
  group: string;
  title: string;
  description: string;
  /** Переменная → что в ней (для подсказки в админке) */
  vars: Record<string, string>;
  /** Переменные, без которых письмо теряет смысл или нарушает закон (ссылка отписки) */
  required: readonly string[];
  /** Тестовые значения для предпросмотра и тестового письма */
  sample: Record<string, string>;
  subject: string;
  text: string;
};

export const GLOBAL_VARS = { brand: 'Название площадки', site: 'Адрес сайта (https://…)' } as const;

const def = <V extends Record<string, string>>(d: Omit<Def, 'vars' | 'sample'> & { vars: V; sample: { [K in keyof V]: string } }) => d;

export const MAIL_TEMPLATES = {
  // ─── вход и аккаунт ────────────────────────────────────────────────────
  'auth.verify_email': def({
    group: 'Вход и аккаунт',
    title: 'Подтверждение email',
    description: 'После регистрации и по кнопке «подтвердить email» в профиле.',
    vars: { link: 'Ссылка подтверждения', hours: 'Сколько часов действует ссылка' },
    required: ['link'],
    sample: { link: 'https://example.ru/verify-email?token=TEST', hours: '48' },
    subject: 'Подтвердите email — {{brand}}',
    text: 'Чтобы подтвердить email, перейдите по ссылке:\n{{link}}\n\nСсылка действует {{hours}} ч.',
  }),
  'auth.password_reset': def({
    group: 'Вход и аккаунт',
    title: 'Сброс пароля',
    description: 'По запросу «Забыли пароль?». Ответ сайта одинаков для существующего и несуществующего email.',
    vars: { link: 'Ссылка на страницу нового пароля', minutes: 'Сколько минут действует ссылка' },
    required: ['link'],
    sample: { link: 'https://example.ru/reset-password?token=TEST', minutes: '30' },
    subject: 'Восстановление пароля — {{brand}}',
    text: 'Чтобы задать новый пароль, перейдите по ссылке:\n{{link}}\n\nСсылка одноразовая и действует {{minutes}} минут. Если вы не запрашивали сброс, просто проигнорируйте письмо.',
  }),
  'auth.account_created': def({
    group: 'Вход и аккаунт',
    title: 'Аккаунт создан менеджером — задайте пароль',
    description: 'Покупателю без аккаунта, для которого менеджер оформил заказ из премиум-заявки.',
    vars: { name: 'Имя покупателя', link: 'Ссылка, по которой задаётся пароль (7 дней)', 'order.number': 'Номер заказа' },
    required: ['link'],
    sample: { name: 'Елена', link: 'https://example.ru/reset-password?token=TEST', 'order.number': '100123' },
    subject: 'Ваш аккаунт — {{brand}}',
    text:
      'Здравствуйте, {{name}}!\n\nМы оформили для вас заказ № {{order.number}} и создали аккаунт на этот email — в нём видно статус заказа и доставки.\n' +
      'Чтобы входить в аккаунт, задайте пароль по ссылке:\n{{link}}\n\nСсылка действует 7 дней. Если пароль не нужен, просто проигнорируйте письмо — оплатить заказ можно и без входа.',
  }),
  'auth.staff_invite': def({
    group: 'Вход и аккаунт',
    title: 'Приглашение сотрудника админки',
    description: '«Сотрудники и настройки» → «Пригласить».',
    vars: { role: 'Роль сотрудника', link: 'Ссылка, по которой задаётся пароль (7 дней)' },
    required: ['link'],
    sample: { role: 'Модератор', link: 'https://example.ru/reset-password?token=TEST' },
    subject: 'Доступ в админку — {{brand}}',
    text: 'Вас пригласили в админку {{brand}} с ролью «{{role}}».\nЧтобы задать пароль, перейдите по ссылке:\n{{link}}\n\nПосле этого войдите на {{site}}/admin. Ссылка действует 7 дней.',
  }),

  // ─── поставщики ────────────────────────────────────────────────────────
  'supplier.application_received': def({
    group: 'Поставщики',
    title: 'Заявка поставщика получена',
    description: 'Компании сразу после отправки заявки на подключение.',
    vars: { contactName: 'Контактное лицо', company: 'Название компании', consentVersion: 'Версия согласия на обработку ПДн' },
    required: [],
    sample: { contactName: 'Ирина', company: 'ООО «МедТекс»', consentVersion: '2026-10-01' },
    subject: 'Заявка на подключение получена — {{brand}}',
    text: 'Здравствуйте, {{contactName}}!\nМы получили заявку компании «{{company}}». Менеджер свяжется с вами в течение 2 часов в рабочее время.\nСогласие на обработку данных: версия {{consentVersion}}.',
  }),
  'supplier.application_rejected': def({
    group: 'Поставщики',
    title: 'Заявка поставщика отклонена',
    description: 'Когда админ отклоняет заявку с причиной.',
    vars: { contactName: 'Контактное лицо', company: 'Название компании', reason: 'Причина отказа' },
    required: ['reason'],
    sample: { contactName: 'Ирина', company: 'ООО «МедТекс»', reason: 'ассортимент не относится к медицинской одежде' },
    subject: 'Заявка на подключение — {{brand}}',
    text: 'Здравствуйте, {{contactName}}!\nК сожалению, сейчас мы не можем подключить компанию «{{company}}».\nПричина: {{reason}}',
  }),
  'supplier.invite': def({
    group: 'Поставщики',
    title: 'Приглашение в кабинет поставщика',
    description: 'Новому пользователю: при одобрении заявки (владелец) и при добавлении сотрудника поставщиком.',
    vars: { 'supplier.name': 'Юрлицо поставщика', link: 'Ссылка, по которой задаётся пароль (7 дней)' },
    required: ['link'],
    sample: { 'supplier.name': 'ООО «МедТекс»', link: 'https://example.ru/supplier/invite?token=TEST' },
    subject: 'Доступ в кабинет поставщика — {{brand}}',
    text: 'Вас пригласили в кабинет поставщика «{{supplier.name}}».\nЧтобы задать пароль и войти, перейдите по ссылке:\n{{link}}\n\nСсылка действует 7 дней.',
  }),
  'supplier.approved_existing': def({
    group: 'Поставщики',
    title: 'Кабинет открыт (аккаунт уже был)',
    description: 'При одобрении заявки, если у контактного email уже есть аккаунт.',
    vars: { 'supplier.name': 'Юрлицо поставщика', loginUrl: 'Страница входа поставщика' },
    required: [],
    sample: { 'supplier.name': 'ООО «МедТекс»', loginUrl: 'https://example.ru/supplier/login' },
    subject: 'Кабинет поставщика открыт — {{brand}}',
    text: 'Компания «{{supplier.name}}» подключена. Войдите со своим паролем: {{loginUrl}}',
  }),
  'supplier.member_access': def({
    group: 'Поставщики',
    title: 'Доступ к кабинету (аккаунт уже был)',
    description: 'Поставщик добавил сотрудника, у которого уже есть аккаунт.',
    vars: { 'supplier.name': 'Юрлицо поставщика', loginUrl: 'Страница входа поставщика' },
    required: [],
    sample: { 'supplier.name': 'ООО «МедТекс»', loginUrl: 'https://example.ru/supplier/login' },
    subject: 'Доступ в кабинет поставщика — {{brand}}',
    text: 'Вам открыли доступ к кабинету «{{supplier.name}}». Войдите: {{loginUrl}}',
  }),
  'supplier.notification': def({
    group: 'Поставщики',
    title: 'Уведомление поставщику (копия колокольчика)',
    description: 'Email-копия события из центра уведомлений: новый заказ, просрочка, модерация, импорт, акции, отзывы. Уходит, если email включён в настройках сотрудника.',
    vars: { title: 'Заголовок события', body: 'Текст события', link: 'Ссылка в кабинет (может быть пустой)' },
    required: ['title'],
    sample: { title: 'Новый заказ № 100123-1', body: 'Оплачено отправление на 4 590 ₽: Костюм «Классика», M × 1. Подтвердите его в течение 48 ч.', link: 'https://example.ru/supplier/orders/TEST' },
    subject: '{{title}}',
    text: '{{body}}\n\n{{link}}',
  }),

  // ─── заказы ────────────────────────────────────────────────────────────
  'order.paid': def({
    group: 'Заказы',
    title: 'Заказ оплачен',
    description: 'Покупателю после подтверждения оплаты платёжкой.',
    vars: { 'order.number': 'Номер заказа', 'order.total': 'Сумма заказа', shipments: '«2 отправления»', eta: 'Ориентировочная дата доставки', orderUrl: 'Ссылка на заказ в профиле' },
    required: ['order.number'],
    sample: { 'order.number': '100123', 'order.total': '12 480 ₽', shipments: '2 отправления', eta: '05.11.2026', orderUrl: 'https://example.ru/account/orders/100123' },
    subject: 'Заказ № {{order.number}} оплачен — {{brand}}',
    text: 'Спасибо! Заказ № {{order.number}} на {{order.total}} оплачен.\n{{shipments}}, доставим ориентировочно {{eta}}.\nДетали: {{orderUrl}}',
  }),
  'order.shipment_cancelled': def({
    group: 'Заказы',
    title: 'Отправление отменено',
    description: 'Отмена покупателем, поставщиком, поддержкой или автоотмена без подтверждения.',
    vars: { 'shipment.number': 'Номер отправления «100123-1»', reason: 'Причина', refundNote: 'Фраза о возврате денег (пусто, если заказ не был оплачен)' },
    required: ['shipment.number'],
    sample: { 'shipment.number': '100123-1', reason: 'Поставщик не подтвердил заказ за 48 ч', refundNote: 'Деньги вернутся на карту или счёт СБП, обычно в течение нескольких дней.' },
    subject: 'Отправление № {{shipment.number}} отменено',
    text: 'Отправление № {{shipment.number}} отменено: {{reason}}.\n{{refundNote}}',
  }),
  'order.return_approved': def({
    group: 'Заказы',
    title: 'Возврат принят',
    description: 'Поставщик одобрил заявку на возврат — деньги отправлены покупателю.',
    vars: { 'shipment.number': 'Номер отправления', amount: 'Сумма возврата', orderUrl: 'Ссылка на заказ в профиле' },
    required: ['shipment.number'],
    sample: { 'shipment.number': '100123-1', amount: '4 590 ₽', orderUrl: 'https://example.ru/account/orders/100123' },
    subject: 'Возврат по отправлению № {{shipment.number}} принят — {{brand}}',
    text: 'Заявка на возврат по отправлению № {{shipment.number}} принята. Возвращаем {{amount}} — деньги придут на карту или счёт СБП, обычно в течение нескольких дней.\nДетали: {{orderUrl}}',
  }),
  'order.return_rejected': def({
    group: 'Заказы',
    title: 'Возврат отклонён',
    description: 'Поставщик отклонил заявку на возврат с причиной.',
    vars: { 'shipment.number': 'Номер отправления', reason: 'Причина отказа', orderUrl: 'Ссылка на заказ в профиле' },
    required: ['reason'],
    sample: { 'shipment.number': '100123-1', reason: 'на изделии следы носки', orderUrl: 'https://example.ru/account/orders/100123' },
    subject: 'Возврат по отправлению № {{shipment.number}} — {{brand}}',
    text: 'Поставщик отклонил заявку на возврат по отправлению № {{shipment.number}}: {{reason}}.\nЕсли вы не согласны, ответьте на это письмо — разберёмся.\nДетали: {{orderUrl}}',
  }),
  'order.payment_link': def({
    group: 'Заказы',
    title: 'Ссылка на оплату заказа от менеджера',
    description: 'Заказ, который менеджер оформил из премиум-заявки: состав, доставка и ссылка на оплату.',
    vars: {
      name: 'Имя получателя', 'order.number': 'Номер заказа', 'order.total': 'Сумма к оплате', items: 'Состав заказа (строки)', delivery: 'Доставка по отправлениям (строки)',
      paymentUrl: 'Ссылка на оплату', payUntil: 'До какого времени держим резерв', orderUrl: 'Ссылка на заказ в профиле',
    },
    required: ['paymentUrl'],
    sample: {
      name: 'Елена', 'order.number': '100123', 'order.total': '24 900 ₽', items: '• Топ «Уют», M — 4 590 ₽\n• Брюки «Уют», L — 4 230 ₽', delivery: '• Отправление 1: ПВЗ СДЭК, Москва, ул. Ленина, 1 — 390 ₽',
      paymentUrl: 'https://example.ru/pay/test/TEST', payUntil: '28.10.2026, 18:00', orderUrl: 'https://example.ru/account/orders/100123',
    },
    subject: 'Заказ № {{order.number}}: ссылка на оплату — {{brand}}',
    text:
      'Здравствуйте, {{name}}!\n\nМы собрали ваш заказ № {{order.number}}:\n{{items}}\n\nДоставка:\n{{delivery}}\n\nК оплате: {{order.total}}.\n' +
      'Оплатить картой или через СБП: {{paymentUrl}}\n\nВещи зарезервированы до {{payUntil}}. После оплаты статус заказа виден в профиле: {{orderUrl}}',
  }),

  // ─── отзывы ────────────────────────────────────────────────────────────
  'review.invite': def({
    group: 'Отзывы',
    title: 'Приглашение оставить отзыв',
    description: 'Через 7 дней после доставки отправления, один раз на отправление. Не уходит отписавшимся, удалённым и заблокированным, без действующего согласия на обработку ПДн.',
    vars: { name: 'Имя из анкеты (или «покупатель»)', 'order.number': 'Номер заказа', products: 'Товары отправления (строки)', orderUrl: 'Ссылка на заказ, где оставляется отзыв', unsubscribeUrl: 'Ссылка отписки от таких писем' },
    required: ['orderUrl', 'unsubscribeUrl'],
    sample: { name: 'Елена', 'order.number': '100123', products: '• Костюм «Классика», M\n• Сабо «Light», 38', orderUrl: 'https://example.ru/account/orders/100123', unsubscribeUrl: 'https://example.ru/review-invites/unsubscribe?token=TEST' },
    subject: 'Как вам покупка? — {{brand}}',
    text:
      'Здравствуйте, {{name}}!\n\nНеделю назад вы получили заказ № {{order.number}}:\n{{products}}\n\nРасскажите, как сидит и носится, — оценка и пара слов помогут коллегам выбрать размер. ' +
      'Оставить отзыв: {{orderUrl}}\n\n—\nОтписаться от писем с просьбой об отзыве: {{unsubscribeUrl}}',
  }),
  'review.rejected': def({
    group: 'Отзывы',
    title: 'Отзыв не опубликован',
    description: 'Модератор отклонил или снял отзыв с причиной.',
    vars: { 'product.title': 'Товар', reason: 'Причина', profileUrl: 'Ссылка на «Мои отзывы»' },
    required: ['reason'],
    sample: { 'product.title': 'Костюм «Классика»', reason: 'в тексте ссылка на другой магазин', profileUrl: 'https://example.ru/account#reviews' },
    subject: 'Отзыв не опубликован — {{brand}}',
    text: 'Ваш отзыв о товаре «{{product.title}}» не прошёл модерацию: {{reason}}.\nИсправить и отправить снова можно в профиле: {{profileUrl}}',
  }),

  // ─── «Сообщить о поступлении» ──────────────────────────────────────────
  'restock.confirm': def({
    group: 'Сообщить о поступлении',
    title: 'Подписка оформлена (гостю)',
    description: 'Гостю после подписки — если email ввёл кто-то другой, владелец адреса отпишется в один клик.',
    vars: { 'product.title': 'Товар', variant: 'Цвет, размер, рост', productUrl: 'Ссылка на товар', unsubscribeUrl: 'Ссылка отписки' },
    required: ['unsubscribeUrl'],
    sample: { 'product.title': 'Халат «Классика»', variant: 'белый, размер XXL', productUrl: 'https://example.ru/product/halat-klassika', unsubscribeUrl: 'https://example.ru/restock/unsubscribe?token=TEST' },
    subject: 'Сообщим о поступлении — {{brand}}',
    text:
      'Вы подписались на уведомление о поступлении: «{{product.title}}», {{variant}}.\nПришлём одно письмо, когда товар снова появится в наличии.\n\n' +
      'Товар: {{productUrl}}\nЕсли это были не вы или уведомление больше не нужно — отписаться: {{unsubscribeUrl}}',
  }),
  'restock.available': def({
    group: 'Сообщить о поступлении',
    title: 'Товар снова в наличии',
    description: 'Фоновая задача при пополнении остатка, одно письмо на подписку.',
    vars: { 'product.title': 'Товар', variant: 'Цвет, размер, рост', productUrl: 'Ссылка на товар', unsubscribeUrl: 'Ссылка отписки' },
    required: ['productUrl', 'unsubscribeUrl'],
    sample: { 'product.title': 'Халат «Классика»', variant: 'белый, размер XXL', productUrl: 'https://example.ru/product/halat-klassika', unsubscribeUrl: 'https://example.ru/restock/unsubscribe?token=TEST' },
    subject: '«{{product.title}}» снова в наличии — {{brand}}',
    text:
      'Здравствуйте!\n\nТовар, о котором вы просили сообщить, снова в наличии: «{{product.title}}», {{variant}}.\nКупить: {{productUrl}}\n\n' +
      'Остатки ограничены — это письмо приходит один раз, подписка на этот вариант закрыта.\n—\nОтписаться от уведомлений о поступлении: {{unsubscribeUrl}}',
  }),

  // ─── рассылка ──────────────────────────────────────────────────────────
  'newsletter.promotion': def({
    group: 'Рассылка',
    title: 'Рассылка по акции',
    description: 'Кнопка «Разослать покупателям» в акциях: покупателям с согласием на рассылку. Ссылка отписки обязательна (38-ФЗ, ТЗ §11).',
    vars: {
      'promotion.name': 'Название акции', when: '«Акция идёт до 3 ноября» или «Акция пройдёт с … по …»', minDiscount: 'Минимальная скидка, %', description: 'Описание акции (может быть пустым)',
      products: 'Товары по акции с ценами — с заголовком; пусто, если товаров нет', catalogLine: 'Строка со ссылкой на каталог акции', unsubscribeUrl: 'Ссылка отписки', profileUrl: 'Ссылка на профиль',
    },
    required: ['unsubscribeUrl'],
    sample: {
      'promotion.name': 'Неделя хирурга', when: 'Акция идёт до 3 ноября', minDiscount: '15', description: 'Скидки на хирургические костюмы и шапочки.',
      products: 'Товары по акции:\n• Костюм «Классика» — 3 900 ₽ вместо 4 590 ₽ (−15%)\n  https://example.ru/product/kostyum-klassika', catalogLine: 'Все товары по акции: https://example.ru/catalog?sale=1',
      unsubscribeUrl: 'https://example.ru/unsubscribe?token=TEST', profileUrl: 'https://example.ru/account',
    },
    subject: '{{promotion.name}}: скидки от {{minDiscount}}% — {{brand}}',
    text:
      'Здравствуйте!\n\n{{promotion.name}}. {{when}}, скидки от {{minDiscount}}%.\n\n{{description}}\n\n{{products}}\n\n{{catalogLine}}\n\n—\n' +
      'Вы получили это письмо, потому что согласились получать рассылку {{brand}} об акциях.\nОтписаться: {{unsubscribeUrl}}\nСогласия можно изменить в профиле: {{profileUrl}}',
  }),

  // ─── премиум и стилист ─────────────────────────────────────────────────
  'premium.lead_manager': def({
    group: 'Премиум и стилист',
    title: 'Премиум-заявка менеджеру',
    description: 'На ALERT_EMAIL при новой заявке из премиум-капсулы.',
    vars: { 'lead.name': 'Имя', 'lead.phone': 'Телефон', 'lead.contact': 'Как связаться', capsule: 'Капсула, вариант, размер', items: 'Вещи с ценами (строки)', total: 'Итого', adminUrl: 'Заявка в админке' },
    required: ['adminUrl'],
    sample: {
      'lead.name': 'Елена', 'lead.phone': '+79991234567', 'lead.contact': 'WhatsApp', capsule: 'Тёмно-синяя капсула, вариант 1, размер M',
      items: '• Топ: Топ «Уют» (МедТекс), Тёмно-синий, M — 4 590 ₽', total: '24 900 ₽', adminUrl: 'https://example.ru/admin/premium/TEST',
    },
    subject: '[{{brand}}] Заявка премиум: {{lead.name}}',
    text: '{{lead.name}}, {{lead.phone}} — связаться: {{lead.contact}}\n\n{{capsule}}\n{{items}}\nИтого: {{total}}\n\nЗаявка в админке: {{adminUrl}}',
  }),
  'premium.lead_telegram': def({
    group: 'Премиум и стилист',
    title: 'Премиум-заявка: ссылка на Telegram',
    description: 'Покупателю с аккаунтом, если в заявке выбран Telegram: ссылка привязывает чат с менеджером.',
    vars: { name: 'Имя', 'lead.no': 'Номер заявки', telegramUrl: 'Ссылка «Открыть Telegram»', days: 'Сколько дней действует ссылка' },
    required: ['telegramUrl'],
    sample: { name: 'Елена', 'lead.no': '№ 12', telegramUrl: 'https://t.me/example_bot?start=lead_TEST', days: '7' },
    subject: 'Заявка {{lead.no}}: менеджер ответит в Telegram',
    text: 'Здравствуйте, {{name}}!\n\nЗаявка {{lead.no}} на премиум-капсулу принята. Менеджер ответит в Telegram — откройте чат с ботом {{brand}} и нажмите «Запустить»:\n\nОткрыть Telegram: {{telegramUrl}}\n\nСсылка одноразовая и действует {{days}} дн.',
  }),
  'premium.lead_message': def({
    group: 'Премиум и стилист',
    title: 'Премиум-заявка: сообщение клиента',
    description: 'На ALERT_EMAIL, когда клиент написал в Telegram по заявке (одно письмо, пока сообщения не прочитаны).',
    vars: { 'lead.name': 'Имя клиента', 'lead.no': 'Номер заявки', text: 'Текст сообщения', adminUrl: 'Заявка в админке' },
    required: ['adminUrl'],
    sample: { 'lead.name': 'Елена', 'lead.no': '№ 12', text: 'А можно халат на размер больше?', adminUrl: 'https://example.ru/admin/premium/TEST' },
    subject: '[{{brand}}] Сообщение по заявке {{lead.no}}: {{lead.name}}',
    text: '{{lead.name}} написал(а) в Telegram по заявке {{lead.no}}:\n\n{{text}}\n\nОтветить: {{adminUrl}}',
  }),
  'stylist.answer': def({
    group: 'Премиум и стилист',
    title: 'Ответ стилиста',
    description: 'Покупателю, когда стилист ответил на вопрос из профиля.',
    vars: { answer: 'Текст ответа', profileUrl: 'Ссылка на профиль' },
    required: ['answer'],
    sample: { answer: 'Вам подойдут холодные оттенки синего и графит.', profileUrl: 'https://example.ru/account' },
    subject: 'Стилист ответил на ваш вопрос',
    text: 'Ответ стилиста:\n\n{{answer}}\n\nВсе ответы — в профиле: {{profileUrl}}\nДоступ стилиста к вашей анкете и фото закрыт.',
  }),

  // ─── персональные данные и система ─────────────────────────────────────
  'privacy.account_deleted': def({
    group: 'Персональные данные',
    title: 'Аккаунт удалён',
    description: 'После удаления аккаунта покупателем или администратором.',
    vars: {},
    required: [],
    sample: {},
    subject: 'Аккаунт удалён — {{brand}}',
    text: 'Ваш аккаунт и персональные данные профиля удалены. Сведения о заказах хранятся для бухгалтерского учёта.',
  }),
  'privacy.photos_deleted': def({
    group: 'Персональные данные',
    title: 'Фото удалены по сроку хранения',
    description: 'Раз в сутки: фото анкеты удаляются у неактивных больше 12 месяцев.',
    vars: {},
    required: [],
    sample: {},
    subject: 'Фото удалены — {{brand}}',
    text: 'Вы не заходили в аккаунт больше года, поэтому фото из анкеты удалены, как обещано в согласии. Профиль и заказы сохранены.',
  }),
  'system.alert': def({
    group: 'Система',
    title: 'Алерт дежурному',
    description: 'На ALERT_EMAIL: сбои вебхуков оплаты, расхождения сверки и т. п.',
    vars: { subject: 'Тема алерта', text: 'Подробности' },
    required: ['subject', 'text'],
    sample: { subject: 'Сверка платежей: 1 расхождение', text: '100123: оплачен в платёжке, у нас «ждёт оплаты» — потерян вебхук' },
    subject: '[{{brand}}] {{subject}}',
    text: '{{text}}',
  }),
} as const;

export type MailTemplateKey = keyof typeof MAIL_TEMPLATES;
/** Значения переменных шаблона K (числа приводятся к строке) */
export type MailVars<K extends MailTemplateKey> = { [V in keyof (typeof MAIL_TEMPLATES)[K]['vars']]: string | number | null | undefined };

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Переменные, встречающиеся в строке */
export function tokensOf(s: string): string[] {
  return [...s.matchAll(TOKEN)].map((m) => m[1]);
}

/**
 * Проверка темы и текста: неизвестные переменные, незакрытые скобки и удалённые обязательные переменные — ошибки
 * по полям (как у форм: { subject?: string, text?: string }).
 */
export function validateTemplate(key: MailTemplateKey, subject: string, text: string): Record<string, string> {
  const d = MAIL_TEMPLATES[key] as Def;
  const known = new Set([...Object.keys(d.vars), ...Object.keys(GLOBAL_VARS)]);
  const errors: Record<string, string> = {};
  for (const [field, value] of [['subject', subject], ['text', text]] as const) {
    const unknown = [...new Set(tokensOf(value).filter((t) => !known.has(t)))];
    if (unknown.length) errors[field] = `Неизвестные переменные: ${unknown.map((t) => `{{${t}}}`).join(', ')}`;
    else if (/\{\{|\}\}/.test(value.replace(TOKEN, ''))) errors[field] = 'Незакрытая подстановка — переменная пишется как {{имя}}';
  }
  const used = new Set([...tokensOf(subject), ...tokensOf(text)]);
  const missing = d.required.filter((r) => !used.has(r));
  if (missing.length && !errors.text) errors.text = `Обязательные переменные нельзя удалить: ${missing.map((t) => `{{${t}}}`).join(', ')}`;
  return errors;
}

/** Подстановка: неизвестное и пустое — пустая строка; тройные переводы строк от пустых блоков схлопываются. */
export function renderTemplate(subject: string, text: string, vars: Record<string, string | number | null | undefined>) {
  const sub = (s: string) => s.replace(TOKEN, (_, name: string) => (vars[name] == null ? '' : String(vars[name])));
  return {
    // В теме переводы строк недопустимы (заголовок письма): название товара или причина могли их содержать
    subject: sub(subject).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    text: sub(text)
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

export type MailTemplateDef = Def;
