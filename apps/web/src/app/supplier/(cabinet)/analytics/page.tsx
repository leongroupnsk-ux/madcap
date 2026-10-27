import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/supplier/cabinet.module.css';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import { Analytics, type AnalyticsData } from './Analytics';

export const metadata: Metadata = { title: 'Аналитика' };

/** Аналитика продаж поставщика: только владельцу (как выплаты) */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const me = await requireSupplier();
  if (!me) return null;
  if (me.role !== 'owner')
    return (
      <div className={s.head}>
        <div>
          <div className="eyebrow">Аналитика</div>
          <h1>Аналитика продаж</h1>
          <p className={s.lead}>
            Раздел доступен владельцу кабинета. <Link href="/supplier" className={s.link}>На дашборд</Link>
          </p>
        </div>
      </div>
    );
  const days = (await searchParams).days === '90' ? 90 : 30;
  const res = await serverApi<AnalyticsData>(`/supplier/analytics?days=${days}`);
  return <Analytics data={res.data} days={days} />;
}
