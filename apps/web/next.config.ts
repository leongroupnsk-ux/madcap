import path from 'node:path';
import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';
const prod = process.env.NODE_ENV === 'production';

/**
 * Политика безопасности контента (ТЗ §11). Скрипты Next.js встраиваются inline, поэтому без
 * nonce остаётся 'unsafe-inline'; страницы нельзя встроить во фрейм.
 * Оплата — переход на страницу ЮKassa (redirect), отдельных разрешений не требует.
 * Внешние источники — только для интеграций, которые включаются ключом в API (скрипты грузятся лениво,
 * без ключа запросов к ним нет):
 * - Яндекс SmartCaptcha (E6-06): скрипт и iframe виджета — smartcaptcha.yandexcloud.net;
 * - Яндекс Карты JS API 3.x (E4-09): загрузчик и модули — api-maps.yandex.ru и yastatic.net,
 *   тайлы, данные и иконки — *.maps.yandex.net, рендер в web worker из blob:.
 */
const SMARTCAPTCHA = 'https://smartcaptcha.yandexcloud.net';
const YMAPS = 'https://api-maps.yandex.ru';
const YMAPS_DATA = 'https://*.maps.yandex.net';
const YASTATIC = 'https://yastatic.net';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? '' : " 'unsafe-eval'"} ${SMARTCAPTCHA} ${YMAPS} ${YASTATIC}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${YMAPS} ${YMAPS_DATA} ${YASTATIC}`,
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${prod ? '' : ' ws:'} ${YMAPS} ${YMAPS_DATA} ${YASTATIC}`,
  `frame-src ${SMARTCAPTCHA}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const security = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(prod ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const config: NextConfig = {
  // В Docker собирается автономный сервер (NEXT_OUTPUT=standalone); трассировка от корня монорепозитория.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const, outputFileTracingRoot: path.join(__dirname, '../..') } : {}),
  // Браузер ходит в API через тот же origin: cookie сессии first-party, CORS не нужен.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: security }];
  },
  poweredByHeader: false,
};

export default config;
