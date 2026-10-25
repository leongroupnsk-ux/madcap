import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/components/supplier/cabinet.module.css';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import { PromotionProducts } from './[id]/PromotionProducts';
import { PhaseBadge, conditionsText, type Promo } from './shared';

export const metadata: Metadata = { title: 'Акции' };

/** Акции платформы для поставщика (ТЗ §7.7, кадр .Partner-Sales): карточки акций и товары главной акции. */
export default async function PromotionsPage() {
  const me = await requireSupplier();
  if (!me) return null;
  const list = (await serverApi<Promo[]>('/supplier/promotions')).data ?? [];
  // Главная акция — идущая с открытым приёмом заявок, иначе любая с открытым приёмом, иначе идущая: её карточка тёмная, её товары — таблицей ниже
  const featured =
    list.find((p) => p.phase === 'running' && p.acceptsApplications) ?? list.find((p) => p.acceptsApplications) ?? list.find((p) => p.phase === 'running') ?? null;
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Кабинет поставщика</div>
          <h1>Акции</h1>
          <p className={s.lead}>Платформа запускает акции — вы заявляете товары и назначаете скидку (заявки проходят быструю модерацию)</p>
        </div>
      </div>
      {list.length === 0 && <div className={s.promoCard}>Сейчас акций нет — мы пришлём уведомление, когда откроется приём заявок.</div>}
      <div className={s.promoCards}>
        {list.map((p) => {
          const dark = p.id === featured?.id;
          const total = p.stats.products + p.stats.pending;
          return (
            <article key={p.id} className={`${s.promoCard} ${dark ? s.promoDark : ''}`}>
              <div className={s.promoHead}>
                <h2>{p.name}</h2>
                <PhaseBadge p={p} dark={dark} />
              </div>
              <p className={s.promoText}>
                {conditionsText(p, me.supplier.commissionBp)}
                {p.requirements && ` Требования: ${p.requirements}`}
              </p>
              <div className={s.promoFoot}>
                <p className={s.promoStats}>
                  Ваших товаров: <b>{p.stats.products}</b>
                  {p.stats.pending > 0 && (
                    <>
                      {' '}
                      · на рассмотрении: <b>{p.stats.pending}</b>
                    </>
                  )}{' '}
                  · продано за неделю: <b>{p.stats.soldWeek} шт.</b>
                </p>
                {p.phase !== 'finished' && (
                  <Link href={`/supplier/promotions/${p.id}`} className={s.promoBtn}>
                    {p.acceptsApplications ? (total ? 'Добавить товары' : 'Заявить товары') : 'Товары в акции'}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {featured && <PromotionProducts id={featured.id} baseBp={me.supplier.commissionBp} embedded />}
    </>
  );
}
