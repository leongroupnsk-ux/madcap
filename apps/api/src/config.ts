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
  session: { cookieName: 'sid', ttlDays: 30 },
  tokens: { emailVerifyHours: 48, passwordResetMinutes: 60 },
};
