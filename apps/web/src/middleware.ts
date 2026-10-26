import { NextResponse, type NextRequest } from 'next/server';

/**
 * Только для админки: передаёт путь страницы в серверный layout (заголовок x-pathname) —
 * layout по нему решает, вести ли сотрудника без обязательной 2FA на /admin/security.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/admin', '/admin/:path*'] };
