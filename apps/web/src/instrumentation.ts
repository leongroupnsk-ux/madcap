import type { Instrumentation } from 'next';

/**
 * Ошибки рендера и обработчиков на сервере сайта → API (POST /api/internal/errors) → сообщение в Telegram
 * (apps/api/src/monitoring). Запрос идёт напрямую в API по сети docker, мимо Caddy. Не сообщается об ответах 5xx
 * от API: о своём сбое API сообщил сам, а если он недоступен целиком, сообщить некому — это ловит ops/health-alert.sh.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const e = err as Error & { digest?: string; status?: number };
  if (e.name === 'ApiUnavailableError' && (e.status ?? 0) >= 500) return;
  const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';
  await fetch(`${api}/api/internal/errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: context.routePath, method: request.method, kind: context.routeType, message: `${e.name}: ${e.message}`.slice(0, 2000), digest: e.digest }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
};
