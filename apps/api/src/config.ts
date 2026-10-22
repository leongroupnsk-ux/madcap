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
  tokens: { emailVerifyHours: 48, passwordResetMinutes: 60 },
};
