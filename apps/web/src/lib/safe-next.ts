/**
 * Адрес возврата после входа или регистрации — только путь на нашем сайте.
 * Отсекает //evil.com, /\evil.com, управляющие символы и любые абсолютные адреса.
 */
export function safeNext(next: string | undefined | null): string | null {
  if (!next || next.length > 500 || !next.startsWith('/') || /[\\\u0000-\u001f]/.test(next)) return null;
  try {
    const base = 'https://local.invalid';
    const u = new URL(next, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}
