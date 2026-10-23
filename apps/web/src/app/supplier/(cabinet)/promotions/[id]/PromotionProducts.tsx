'use client';

import { PROMO_STATUS_LABEL, formatRub, salePriceOf } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { Conditions, PhaseBadge, type Promo } from '../shared';

type Item = { productId: string; title: string; sku: string; thumbUrl: string | null; price: number; discountPct: number | null; salePrice: number | null; status: string; rejectReason: string | null };
type Data = { promotion: Promo; items: Item[] };
const STATUS_CLS: Record<string, string> = { approved: 'b_active', pending: 'b_pending', rejected: 'b_rejected', below_min: 'b_rejected', none: 'b_draft' };

/** «Товары в акции» (ТЗ §7.7): скидка, акционная цена, статус, переключатель участия. */
export function PromotionProducts({ id, baseBp }: { id: string; baseBp: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Record<string, { on: boolean; pct: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (d: Data) => {
    setData(d);
    setDraft(Object.fromEntries(d.items.map((i) => [i.productId, { on: i.status !== 'none', pct: String(i.discountPct ?? d.promotion.minDiscountPct) }])));
  };
  useEffect(() => {
    api<Data>(`/supplier/promotions/${id}`)
      .then(apply)
      .catch((e) => setError(isApiError(e) ? e.message : 'Не удалось загрузить акцию'));
  }, [id]);

  if (!data) return error ? <Alert tone="error">{error}</Alert> : null;
  const p = data.promotion;
  const open = p.acceptsApplications;

  const changed = data.items.filter((i) => {
    const d = draft[i.productId];
    return d && ((d.on && (i.status === 'none' || Number(d.pct) !== i.discountPct)) || (!d.on && i.status !== 'none'));
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    setNotice(null);
    try {
      let res: Data | null = null;
      const add = changed.filter((i) => draft[i.productId].on).map((i) => ({ productId: i.productId, discountPct: Number(draft[i.productId].pct) }));
      if (add.length) res = await api<Data>(`/supplier/promotions/${id}/products`, { items: add });
      for (const i of changed.filter((x) => !draft[x.productId].on)) res = await api<Data>(`/supplier/promotions/${id}/products/${i.productId}`, undefined, 'DELETE');
      if (res) apply(res);
      setNotice(add.length ? 'Заявка отправлена на модерацию' : 'Сохранено');
    } catch (e) {
      if (isApiError(e)) {
        setError(e.message);
        setErrors(e.errors ?? {});
      } else setError('Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/supplier/promotions" className={s.link}>
        ← К акциям
      </Link>
      <div className={s.head} style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">Акция платформы</div>
          <h1>{p.name}</h1>
          <div style={{ marginTop: 8 }}>
            <PhaseBadge p={p} />
          </div>
        </div>
        {open && (
          <div className={s.actions}>
            <Button onClick={save} disabled={busy || changed.length === 0}>
              {changed.length ? `Сохранить заявку (${changed.length})` : 'Нет изменений'}
            </Button>
          </div>
        )}
      </div>
      {p.description && <p className={s.muted}>{p.description}</p>}
      <Conditions p={p} baseBp={baseBp} />
      {p.requirements && <p className={s.muted}>Требования к товарам: {p.requirements}</p>}
      {!open && <Alert tone="error">Приём заявок {new Date() < new Date(p.applyFrom) ? 'ещё не открыт' : 'закончился'} — участие можно только посмотреть.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0, marginTop: 16 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Участвует</th>
              <th>Товар</th>
              <th>Обычная цена</th>
              <th>Скидка, %</th>
              <th>Акционная цена</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => {
              const d = draft[i.productId] ?? { on: false, pct: '' };
              const pct = Number(d.pct);
              const below = d.on && pct < p.minDiscountPct;
              return (
                <tr key={i.productId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={d.on}
                      disabled={!open}
                      onChange={(e) => setDraft({ ...draft, [i.productId]: { ...d, on: e.target.checked } })}
                      aria-label={`Участие: ${i.title}`}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {i.thumbUrl ? <img src={i.thumbUrl} alt="" className={s.thumb} /> : <span className={s.thumb} />}
                      <span>
                        {i.title}
                        <div className={s.muted}>{i.sku}</div>
                      </span>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>от {formatRub(i.price)}</td>
                  <td>
                    <input
                      className={s.input}
                      style={{ width: 80 }}
                      type="number"
                      min={p.minDiscountPct}
                      max={90}
                      value={d.pct}
                      disabled={!open || !d.on}
                      onChange={(e) => setDraft({ ...draft, [i.productId]: { ...d, pct: e.target.value } })}
                      aria-label={`Скидка: ${i.title}`}
                    />
                    {(below || errors[i.productId]) && <div className={s.neg} style={{ fontSize: 12 }}>{errors[i.productId] ?? `Минимум ${p.minDiscountPct}%`}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.on && pct > 0 && pct < 100 ? `от ${formatRub(salePriceOf(i.price, pct))}` : '—'}</td>
                  <td>
                    <span className={`${s.badge} ${s[STATUS_CLS[i.status]]}`}>{PROMO_STATUS_LABEL[i.status]}</span>
                    {i.rejectReason && <div className={s.muted}>{i.rejectReason}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.items.length === 0 && <p className={s.muted} style={{ padding: 24 }}>Нет опубликованных товаров для участия.</p>}
      </div>
    </>
  );
}
