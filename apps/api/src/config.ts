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
    !process.env.UNSUBSCRIBE_SECRET && 'нужен UNSUBSCRIBE_SECRET (подпись ссылок отписки от рассылки)',
    !config.webOrigin.startsWith('https://') && 'WEB_ORIGIN должен быть https://',
  ].filter(Boolean);
  if (problems.length) throw new Error(`Небезопасная конфигурация продакшена:\n- ${problems.join('\n- ')}\n(для демо-стенда — ALLOW_TEST_PROVIDERS=1)`);
}
