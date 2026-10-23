import path from 'node:path';
import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';
const prod = process.env.NODE_ENV === 'production';

/**
 * Политика безопасности контента (ТЗ §11). Скрипты Next.js встраиваются inline, поэтому без
 * nonce остаётся 'unsafe-inline'; внешние источники запрещены, страницы нельзя встроить во фрейм.
 * Оплата — переход на страницу ЮKassa (redirect), отдельных разрешений не требует.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${prod ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self'${prod ? '' : ' ws:'}`,
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
