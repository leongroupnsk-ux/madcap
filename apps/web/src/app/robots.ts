import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/catalog';

/** Кабинеты, анкета, корзина и оформление не индексируются (ТЗ §11). Демо-стенд (SITE_NOINDEX=1) закрыт целиком. */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_NOINDEX === '1') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/supplier', '/admin', '/account', '/quiz', '/capsule', '/cart', '/checkout', '/search', '/api/', '/login', '/register', '/reset-password', '/verify-email'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
