'use client';

import { PROMO_STATUS_LABEL, formatRub, salePriceOf } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { PhaseBadge, type Promo } from '../promotions/shared';

type Row = Omit<Promo, 'stats'> & { price: number; discountPct: number | null; salePrice: number | null; status: string; rejectReason: string | null };
const STATUS_CLS: Record<string, string> = { approved: 'b_active', pending: 'b_pending', rejected: 'b_rejected', below_min: 'b_rejected', none: 'b_draft' };

/** Блок «Акции» в форме товара (ТЗ §7.3): доступные акции, условия и участие этого товара. */
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
    <section className={s.panel}>
      <b>Акции</b>
      <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
        {rows.map((p) => {
          const n = Number(pct[p.id]);
          const joined = p.status !== 'none';
          return (
            <div key={p.id} style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--c-border)', paddingTop: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Link href={`/supplier/promotions/${p.id}`} className={s.link}>
                  {p.name}
                </Link>
                <PhaseBadge p={{ ...p, stats: { products: 0, pending: 0, soldWeek: 0 } }} />
                <span className={`${s.badge} ${s[STATUS_CLS[p.status]]}`}>{PROMO_STATUS_LABEL[p.status]}</span>
              </div>
              <span className={s.muted}>
                Скидка от {p.minDiscountPct}% · комиссия {p.commissionBp / 100}% · бейдж «{p.badge}»
                {p.rejectReason && ` · ${p.rejectReason}`}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className={s.input}
                  style={{ width: 80 }}
                  type="number"
                  min={p.minDiscountPct}
                  max={90}
                  value={pct[p.id] ?? ''}
                  disabled={!p.acceptsApplications}
                  onChange={(e) => setPct({ ...pct, [p.id]: e.target.value })}
                  aria-label={`Скидка в акции «${p.name}», %`}
                />
                <span className={s.muted}>% → от {n > 0 && n < 100 ? formatRub(salePriceOf(p.price, n)) : '—'}</span>
                {p.acceptsApplications && (
                  <Button variant={joined ? 'outline' : 'primary'} disabled={busy === p.id || (!joined && n < p.minDiscountPct)} onClick={() => act(p, true)}>
                    {joined ? 'Изменить скидку' : 'Участвовать'}
                  </Button>
                )}
                {joined && (
                  <Button variant="ghost" disabled={busy === p.id} onClick={() => act(p, false)}>
                    Не участвовать
                  </Button>
                )}
              </div>
              {error?.id === p.id && <span className={s.neg}>{error.text}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
