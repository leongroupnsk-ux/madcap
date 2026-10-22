import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { serverApi } from './server-api';
import type { SupplierMe } from './types';

/**
 * Контекст поставщика для серверных страниц кабинета. Лэйаут и страница рендерятся
 * параллельно, поэтому редирект нужен в каждой точке входа, а не только в лэйауте.
 */
export const requireSupplier = cache(async (): Promise<SupplierMe | null> => {
  const { status, data } = await serverApi<SupplierMe>('/supplier/me');
  if (status === 401) redirect('/supplier/login');
  return data;
});
