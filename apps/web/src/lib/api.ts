/** Клиентские запросы к API через /api (тот же origin). */
export type ApiError = { status: number; message: string; errors?: Record<string, string>; code?: string };

export async function api<T = unknown>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', extraHeaders?: Record<string, string>): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const json = body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' };
  const res = await fetch(`/api${path}`, {
    method,
    // extraHeaders — например, X-Captcha-Token после ответа captcha_required
    headers: extraHeaders ? { ...json, ...extraHeaders } : json,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message: typeof data.message === 'string' ? data.message : 'Что-то пошло не так. Попробуйте ещё раз.',
      errors: data.errors,
      code: data.code,
    };
    // Обязательная 2FA ещё не включена (или правило включили, пока страница была открыта) — на страницу настройки
    if (err.code === 'twofa_setup_required' && typeof window !== 'undefined' && window.location.pathname !== '/admin/security') {
      window.location.assign('/admin/security');
    }
    throw err;
  }
  return data as T;
}

export const isApiError = (e: unknown): e is ApiError => typeof e === 'object' && e !== null && 'status' in e && 'message' in e;
