'use client';

import { PROMO_STATUS_LABEL, formatRub, salePriceOf } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { PhaseBadge, conditionsText, type Promo } from '../shared';

type Item = { productId: string; title: string; sku: string; thumbUrl: string | null; price: number; discountPct: number | null; salePrice: number | null; status: string; rejectReason: string | null };
type Data = { promotion: Promo; items: Item[] };
const STATUS_CLS: Record<string, string> = { approved: 'b_s_new', pending: 'b_pending', rejected: 'b_rejected', below_min: 'b_pending', none: 'b_draft' };

/** «Товары в акции» (ТЗ §7.7): скидка, акционная цена, статус, переключатель участия. */
export function PromotionProducts({ id, baseBp, embedded }: { id: string; baseBp: number; embedded?: boolean }) {
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

  // Приём заявок закрыт — показываем только товары, которые участвуют
  const rows = open ? data.items : data.items.filter((i) => i.status !== 'none');
  const table = (
    <section className={s.promoTable}>
      <div className={s.promoTableHead}>
        <h2>
          Товары в «{p.name}» · {data.items.filter((i) => draft[i.productId]?.on).length}
        </h2>
        <span className={s.promoHint}>
          {open ? `акционная цена — минимум −${p.minDiscountPct}%` : `приём заявок ${new Date() < new Date(p.applyFrom) ? 'ещё не открыт' : 'закрыт'} — участие можно только посмотреть`}
        </span>
        {open && (
          <Button className={s.rowBtn} onClick={save} disabled={busy || changed.length === 0}>
            {changed.length ? `Сохранить заявку (${changed.length})` : 'Нет изменений'}
          </Button>
        )}
      </div>
      {(error || notice) && (
        <div className={s.promoAlerts}>
          {error && <Alert tone="error">{error}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
        </div>
      )}
      <div className={s.scroll}>
        <table className={`${s.table} ${s.promoGrid}`}>
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Товар</th>
              <th scope="col">Обычная</th>
              <th scope="col">Акционная</th>
              <th scope="col">Скидка</th>
              <th scope="col">Статус</th>
              <th scope="col">Участие</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const d = draft[i.productId] ?? { on: false, pct: '' };
              const pct = Number(d.pct);
              const below = d.on && pct < p.minDiscountPct;
              const status = below && i.status === 'none' ? 'below_min' : i.status;
              return (
                <tr key={i.productId}>
                  <td data-label="Товар">
                    <span className={s.promoProduct}>
                      {i.thumbUrl ? <img src={i.thumbUrl} alt="" /> : <span className={s.promoNoimg} />}
                      <span>
                        {i.title}
                        <small>{i.sku}</small>
                      </span>
                    </span>
                  </td>
                  <td data-label="Обычная" className={s.promoOld}>
                    <s>{formatRub(i.price)}</s>
                  </td>
                  <td data-label="Акционная" className={s.promoNew}>
                    {d.on && pct > 0 && pct < 100 ? formatRub(salePriceOf(i.price, pct)) : '—'}
                  </td>
                  <td data-label="Скидка">
                    {d.on ? (
                    <label className={s.promoPct}>
                      <span>−</span>
                      <input
                        type="number"
                        min={p.minDiscountPct}
                        max={90}
                        value={d.pct}
                        disabled={!open}
                        onChange={(e) => setDraft({ ...draft, [i.productId]: { ...d, pct: e.target.value } })}
                        aria-label={`Скидка, %: ${i.title}`}
                      />
                      <span>%</span>
                    </label>
                    ) : (
                      '—'
                    )}
                    {(below || errors[i.productId]) && <div className={s.promoErr}>{errors[i.productId] ?? `Минимум ${p.minDiscountPct}%`}</div>}
                  </td>
                  <td data-label="Статус">
                    <span className={`${s.promoStatus} ${s[STATUS_CLS[status]]}`}>{status === 'below_min' ? `Скидка < ${p.minDiscountPct}%` : PROMO_STATUS_LABEL[status]}</span>
                    {i.rejectReason && <div className={s.sub}>{i.rejectReason}</div>}
                  </td>
                  <td data-label="Участие">
                    <input
                      type="checkbox"
                      role="switch"
                      className={s.toggle}
                      checked={d.on}
                      disabled={!open}
                      onChange={(e) => setDraft({ ...draft, [i.productId]: { ...d, on: e.target.checked } })}
                      aria-label={`Участие: ${i.title}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className={`${s.muted} ${s.promoFoot2}`}>{open ? 'Нет опубликованных товаров для участия.' : 'Ваших товаров в этой акции нет.'}</p>}
      <p className={s.promoFoot2}>Цены снижаются автоматически на время акции, сплит-выплата считается от акционной цены и льготной комиссии.</p>
    </section>
  );

  if (embedded) return table;

  return (
    <>
      <Link href="/supplier/promotions" className={s.back}>
        ← К акциям
      </Link>
      <div className={`${s.head} ${s.detailHead}`}>
        <div>
          <div className="eyebrow">Акция платформы</div>
          <div className={s.titleRow}>
            <h1>{p.name}</h1>
            <PhaseBadge p={p} />
          </div>
          <p className={s.lead}>{conditionsText(p, baseBp)}</p>
          {p.requirements && <p className={s.lead}>Требования к товарам: {p.requirements}</p>}
        </div>
      </div>
      {table}
    </>
  );
}
