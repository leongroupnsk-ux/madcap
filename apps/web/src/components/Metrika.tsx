import { Suspense } from 'react';
import { MetrikaCounter } from './MetrikaCounter';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

/** Номер счётчика — из публичного конфига API (METRIKA_ID), кэш 5 минут; без номера ничего не выводится */
async function metrikaId(): Promise<number | null> {
  const res = await fetch(`${API}/api/public-config`, { next: { revalidate: 300 } }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { metrikaId?: number | null } | null) : null;
  return typeof data?.metrikaId === 'number' ? data.metrikaId : null;
}

/** Яндекс Метрика на публичных страницах (витрина, анкета, премиум); в кабинетах и админке не подключается. */
export async function Metrika() {
  const id = await metrikaId();
  if (!id) return null;
  return (
    // useSearchParams в счётчике требует границу Suspense, чтобы страница не теряла статическую отрисовку
    <Suspense fallback={null}>
      <MetrikaCounter id={id} />
    </Suspense>
  );
}
