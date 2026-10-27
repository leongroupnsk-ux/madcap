import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.API_PORT ?? 4100),
  webOrigin: required('WEB_ORIGIN'),
  redisUrl: required('REDIS_URL'),
  brandName: process.env.BRAND_NAME ?? 'aesculap',
  mailDriver: process.env.MAIL_DRIVER ?? 'console',
  /** smtp://user:pass@smtp.example.ru:465 — для MAIL_DRIVER=smtp */
  smtpUrl: process.env.SMTP_URL ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'aesculap <noreply@example.ru>',
  /** Куда слать алерты о сбоях (вебхуки оплаты) */
  alertEmail: process.env.ALERT_EMAIL ?? '',
  /** Telegram-бот уведомлений поставщикам; без токена бот выключен */
  telegram: { token: process.env.TELEGRAM_BOT_TOKEN ?? '', username: process.env.TELEGRAM_BOT_USERNAME ?? '' },
  isProd: process.env.NODE_ENV === 'production',
  /** Без подключённых выплат поставщик не публикуется (ТЗ §7). В dev до этапа 4 можно выключить. */
  storefrontRequirePayouts: process.env.STOREFRONT_REQUIRE_PAYOUTS !== 'false',
  /** Доставка: fake (офлайн, тесты) | cdek (API v2; тестовый контур — api.edu.cdek.ru) */
  delivery: {
    driver: process.env.DELIVERY_DRIVER ?? 'fake',
    cdekUrl: process.env.CDEK_API_URL ?? 'https://api.edu.cdek.ru/v2',
    cdekClientId: process.env.CDEK_CLIENT_ID ?? '',
    cdekSecret: process.env.CDEK_CLIENT_SECRET ?? '',
    cdekFormOrg: Number(process.env.CDEK_OWNERSHIP_FORM_ORG ?? 137),
    cdekFormIp: Number(process.env.CDEK_OWNERSHIP_FORM_IP ?? 63),
  },
  /** Оплата: fake (тестовая страница оплаты) | yookassa */
  payments: {
    driver: process.env.PAYMENTS_DRIVER ?? 'fake',
    yookassaShopId: process.env.YOOKASSA_SHOP_ID ?? '',
    yookassaSecret: process.env.YOOKASSA_SECRET_KEY ?? '',
  },
  orders: {
    /** Резерв остатков и срок оплаты, мин (ТЗ §6.3) */
    payMinutes: Number(process.env.ORDER_PAY_MINUTES ?? 30),
    /** Неподтверждённое отправление отменяется, ч (ТЗ §7.5) */
    confirmHours: Number(process.env.SHIPMENT_CONFIRM_HOURS ?? 48),
  },
  session: { cookieName: 'sid', ttlDays: 30 },
  /**
   * Рассылки по акциям (ТЗ §7.7, §11): секрет подписи ссылок «Отписаться» и темп отправки —
   * пачка писем, затем пауза, чтобы не упереться в лимиты SMTP.
   */
  newsletter: {
    secret: process.env.UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || 'dev-only-unsubscribe-secret',
    batch: Number(process.env.NEWSLETTER_BATCH ?? 50),
    pauseMs: Number(process.env.NEWSLETTER_PAUSE_MS ?? 2000),
  },
  tokens: { emailVerifyHours: 48, passwordResetMinutes: 60 },
  /**
   * Яндекс SmartCaptcha после превышения порога попыток (вход, регистрация, сброс пароля, заявка поставщика).
   * Включается, только когда заданы оба ключа; без них лимиты отвечают 429, как раньше.
   * Ключ клиента отдаётся браузеру через GET /api/auth/captcha-config — смена ключа не требует пересборки web.
   */
  captcha: {
    serverKey: process.env.SMARTCAPTCHA_SERVER_KEY ?? '',
    clientKey: process.env.SMARTCAPTCHA_CLIENT_KEY ?? '',
    validateUrl: 'https://smartcaptcha.yandexcloud.net/validate',
    timeoutMs: Number(process.env.SMARTCAPTCHA_TIMEOUT_MS ?? 5000),
  },
  /** Ключ JS API Яндекс Карт 3.x для карты ПВЗ; отдаётся сайту через GET /api/delivery/config. Пусто — заглушка вместо карты. */
  ymapsKey: process.env.YMAPS_API_KEY ?? '',
  /**
   * Номер счётчика Яндекс Метрики; отдаётся сайту через GET /api/public-config. Пусто (или не число) — счётчика нет,
   * скрипт не грузится. С ключом счётчик подключается только после согласия на аналитические cookie в баннере.
   */
  metrikaId: /^\d{4,12}$/.test(process.env.METRIKA_ID?.trim() ?? '') ? Number(process.env.METRIKA_ID!.trim()) : null,
  /** DaData: подсказки адреса курьера. Ключ только на сервере, браузер ходит через /api/delivery/address-suggest. */
  dadata: {
    apiKey: process.env.DADATA_API_KEY ?? '',
    url: process.env.DADATA_URL ?? 'https://suggestions.dadata.ru/suggestions/api/4_1/rs',
    timeoutMs: Number(process.env.DADATA_TIMEOUT_MS ?? 3000),
  },
  /** Партнёрский API поставщиков (docs/PARTNER_API.md): лимит запросов в минуту на ключ */
  partnerApi: { rpm: Math.max(1, Number(process.env.PARTNER_API_RPM ?? 120)) },
};

/**
 * В продакшене заглушки недопустимы: тестовая оплата перевела бы любой заказ в «оплачен», а письма
 * со ссылками сброса пароля ушли бы в лог. Для демо-стенда — явный ALLOW_TEST_PROVIDERS=1.
 */
export function assertProductionConfig() {
  if (!config.isProd || process.env.ALLOW_TEST_PROVIDERS === '1') return;
  const problems = [
    config.payments.driver !== 'yookassa' && 'PAYMENTS_DRIVER должен быть yookassa',
    config.payments.driver === 'yookassa' && !(config.payments.yookassaShopId && config.payments.yookassaSecret) && 'нужны YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY',
    config.delivery.driver !== 'cdek' && 'DELIVERY_DRIVER должен быть cdek',
    config.delivery.driver === 'cdek' && !(config.delivery.cdekClientId && config.delivery.cdekSecret) && 'нужны CDEK_CLIENT_ID и CDEK_CLIENT_SECRET',
    config.mailDriver !== 'smtp' && 'MAIL_DRIVER должен быть smtp',
    config.mailDriver === 'smtp' && !config.smtpUrl && 'нужен SMTP_URL',
    !config.storefrontRequirePayouts && 'STOREFRONT_REQUIRE_PAYOUTS нельзя выключать',
    Boolean(config.captcha.serverKey) !== Boolean(config.captcha.clientKey) && 'SMARTCAPTCHA_SERVER_KEY и SMARTCAPTCHA_CLIENT_KEY задаются парой',
    !process.env.UNSUBSCRIBE_SECRET && 'нужен UNSUBSCRIBE_SECRET (подпись ссылок отписки от рассылки)',
    !config.webOrigin.startsWith('https://') && 'WEB_ORIGIN должен быть https://',
  ].filter(Boolean);
  if (problems.length) throw new Error(`Небезопасная конфигурация продакшена:\n- ${problems.join('\n- ')}\n(для демо-стенда — ALLOW_TEST_PROVIDERS=1)`);
}
