import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/catalog';

/** Кабинеты, анкета, корзина и оформление не индексируются (ТЗ §11). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/supplier', '/admin', '/account', '/quiz', '/capsule', '/cart', '/checkout', '/search', '/api/', '/login', '/register', '/reset-password', '/verify-email'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
