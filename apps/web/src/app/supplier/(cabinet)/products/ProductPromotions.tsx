'use client';

import { PROMO_STATUS_LABEL, formatRub, salePriceOf } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, isApiError } from '@/lib/api';
import { day, type Promo } from '../promotions/shared';
import f from './form.module.css';

type Row = Omit<Promo, 'stats'> & { price: number; discountPct: number | null; salePrice: number | null; status: string; rejectReason: string | null };

/** Подпись участия после названия акции: «участвует», «можно заявить» и т. п. */
function stateText(p: Row) {
  if (p.status === 'approved') return 'участвует';
  if (p.status !== 'none') return PROMO_STATUS_LABEL[p.status].toLowerCase();
  if (p.acceptsApplications) return 'можно заявить';
  return p.phase === 'scheduled' ? `заявки с ${day(p.applyFrom)}` : 'приём заявок закрыт';
}

/** Блок «Акции» в форме товара (ТЗ §7.3, кадр .Partner-Products-Product): доступные акции и участие этого товара. */
export function ProductPromotions({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pct, setPct] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api<Row[]>(`/supplier/promotions/product/${productId}`)
      .then((r) => {
        setRows(r);
        setPct(Object.fromEntries(r.map((x) => [x.id, String(x.discountPct ?? x.minDiscountPct)])));
      })
      .catch(() => setRows([]));
  useEffect(() => void load(), [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (p: Row, join: boolean) => {
    setBusy(p.id);
    setError(null);
    try {
      if (join) await api(`/supplier/promotions/${p.id}/products`, { items: [{ productId, discountPct: Number(pct[p.id]) }] });
      else await api(`/supplier/promotions/${p.id}/products/${productId}`, undefined, 'DELETE');
      await load();
    } catch (e) {
      setError({ id: p.id, text: isApiError(e) ? (e.errors?.[productId] ?? e.message) : 'Нет связи с сервером' });
    } finally {
      setBusy(null);
    }
  };

  if (!rows?.length) return null;
  return (
    <section className={`${f.box} ${f.boxSm}`}>
      <span className={f.boxTitle}>Акции</span>
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map((p) => {
          const n = Number(pct[p.id]);
          const joined = p.status !== 'none';
          const valid = n >= p.minDiscountPct && n < 100;
          const sale = valid ? salePriceOf(p.price, n) : null;
          return (
            <div key={p.id} className={`${f.promo} ${p.status === 'approved' ? f.promoOn : ''}`}>
              <div className={f.promoHead}>
                <Link href={`/supplier/promotions/${p.id}`} className={f.promoTitle}>
                  {p.name} · {stateText(p)}
                </Link>
                <button
                  type="button"
                  role="switch"
                  className={f.switch}
                  aria-checked={joined}
                  aria-label={joined ? `Выйти из акции «${p.name}»` : `Участвовать в акции «${p.name}»`}
                  disabled={busy === p.id || (!joined && (!p.acceptsApplications || !valid))}
                  onClick={() => act(p, !joined)}
                />
              </div>
              <p className={f.promoText}>
                до {day(p.endsAt)}
                {joined && p.salePrice ? ` · цена ${formatRub(p.salePrice)} (−${p.discountPct}% от ${formatRub(p.price)})` : ` · скидка от ${p.minDiscountPct}%`} · бейдж «{p.badge}» в каталоге · комиссия {p.commissionBp / 100}%
                {p.rejectReason && ` · ${p.rejectReason}`}
              </p>
              {p.acceptsApplications && (
                <div className={f.promoRow}>
                  <input
                    className={f.pct}
                    type="number"
                    min={p.minDiscountPct}
                    max={90}
                    value={pct[p.id] ?? ''}
                    onChange={(e) => setPct({ ...pct, [p.id]: e.target.value })}
                    aria-label={`Скидка в акции «${p.name}», %`}
                  />
                  <span>% → цена {sale ? formatRub(sale) : '—'}</span>
                  {joined && valid && n !== p.discountPct && (
                    <button type="button" className={f.linkBtn} disabled={busy === p.id} onClick={() => act(p, true)}>
                      Изменить скидку
                    </button>
                  )}
                </div>
              )}
              {error?.id === p.id && <span className={f.errors} style={{ padding: 0 }}>{error.text}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
