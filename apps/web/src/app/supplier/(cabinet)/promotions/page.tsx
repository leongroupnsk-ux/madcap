import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/supplier/cabinet.module.css';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import { Conditions, PhaseBadge, type Promo } from './shared';

export const metadata: Metadata = { title: 'Акции' };

/** Акции платформы для поставщика (ТЗ §7.7). */
export default async function PromotionsPage() {
  const me = await requireSupplier();
  if (!me) return null;
  const list = (await serverApi<Promo[]>('/supplier/promotions')).data ?? [];
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Продвижение</div>
          <h1>Акции</h1>
        </div>
      </div>
      <p className={s.muted} style={{ marginBottom: 16 }}>
        Акции запускает платформа. Заявите товары и скидку — на время акции цена на витрине снизится автоматически, а комиссия станет льготной.
      </p>
      {list.length === 0 && <div className={s.panel}>Сейчас акций нет — мы пришлём уведомление, когда откроется приём заявок.</div>}
      <div className={s.tiles} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {list.map((p) => (
          <div key={p.id} className={s.tile} style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            <PhaseBadge p={p} />
            <h2 style={{ fontSize: 24, margin: '6px 0 0' }}>{p.name}</h2>
            {p.description && <p className={s.muted}>{p.description}</p>}
            <Conditions p={p} baseBp={me.supplier.commissionBp} />
            <div className={s.tileHint}>
              Ваших товаров: {p.stats.products}
              {p.stats.pending > 0 && ` · на модерации: ${p.stats.pending}`} · продано за неделю: {p.stats.soldWeek}
            </div>
            {p.phase !== 'finished' && (
              <Link href={`/supplier/promotions/${p.id}`} className={s.link} style={{ marginTop: 6 }}>
                {p.acceptsApplications ? (p.stats.products + p.stats.pending ? 'Добавить товары →' : 'Заявить товары →') : 'Товары в акции →'}
              </Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
