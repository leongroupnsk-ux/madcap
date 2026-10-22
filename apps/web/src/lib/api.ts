/** Клиентские запросы к API через /api (тот же origin). */
export type ApiError = { status: number; message: string; errors?: Record<string, string>; code?: string };

export async function api<T = unknown>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
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
    throw err;
  }
  return data as T;
}

export const isApiError = (e: unknown): e is ApiError => typeof e === 'object' && e !== null && 'status' in e && 'message' in e;
