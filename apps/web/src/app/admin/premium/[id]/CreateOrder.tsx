'use client';

import { formatRub } from '@aesculap/shared';
import { useEffect, useId, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type DraftItem = {
  slotLabel: string; variantId: string; title: string; brand: string; color: string; size: string;
  snapshotPrice: number; price: number | null; available: boolean; stock: number; supplier: { id: string; name: string; city: string | null } | null;
};
type Draft = { recipient: { name: string; phone: string; email: string }; account: { email: string } | null; items: DraftItem[]; payHours: number };
type City = { code: number; city: string; region: string };
type Point = { code: string; name: string; address: string };
type Option = { type: 'pvz' | 'courier'; tariffCode: number; price: number; periodMin: number; periodMax: number };
type Delivery = { type: 'pvz' | 'courier'; pvzCode: string; street: string; flat: string };

/**
 * «Создать заказ» из премиум-заявки: получатель, состав из капсулы (цены и наличие — на сейчас), город и доставка
 * по каждому отправлению (ПВЗ или курьер, тарифы СДЭК как в оформлении). Заказ создаётся обычный, покупателю
 * уходит письмо со ссылкой на оплату.
 */
export function CreateOrder({ leadId, onCreated }: { leadId: string; onCreated: () => void }) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [recipient, setRecipient] = useState({ name: '', phone: '', email: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [cityQ, setCityQ] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [quotes, setQuotes] = useState<{ supplierId: string; options: Option[] }[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Draft>(`/admin/premium/${leadId}/order-draft`)
      .then((d) => {
        setDraft(d);
        setRecipient(d.recipient);
        setPicked(d.items.filter((i) => i.available).map((i) => i.variantId));
      })
      .catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
  }, [leadId]);

  // Подсказки города — как в оформлении, справочник СДЭК
  useEffect(() => {
    if (cityQ.trim().length < 2 || cityQ === city?.city) return setCities([]);
    const t = setTimeout(() => void api<City[]>(`/delivery/cities?q=${encodeURIComponent(cityQ.trim())}`).then(setCities).catch(() => setCities([])), 250);
    return () => clearTimeout(t);
  }, [cityQ, city]);

  // Город или состав поменялись — пересчитать тарифы и загрузить ПВЗ
  useEffect(() => {
    if (!city || !picked.length) return setQuotes([]);
    void api<{ supplierId: string; options: Option[] }[]>(`/admin/premium/${leadId}/quote`, { cityCode: city.code, variantIds: picked })
      .then((q) => {
        setQuotes(q);
        setDelivery((cur) => Object.fromEntries(q.map((x) => [x.supplierId, cur[x.supplierId] ?? { type: x.options[0]?.type ?? 'pvz', pvzCode: '', street: '', flat: '' }])));
      })
      .catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Не удалось посчитать доставку' }));
    void api<Point[]>(`/delivery/points?cityCode=${city.code}`).then(setPoints).catch(() => setPoints([]));
  }, [city, picked, leadId]);

  if (!draft) return msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : <p className={s.muted}>Загружаем состав…</p>;
  const supplierName = (id: string) => draft.items.find((i) => i.supplier?.id === id)?.supplier?.name ?? 'Поставщик';
  const goods = draft.items.filter((i) => picked.includes(i.variantId)).reduce((sum, i) => sum + (i.price ?? 0), 0);
  const deliveryTotal = quotes.reduce((sum, q) => sum + (q.options.find((o) => o.type === delivery[q.supplierId]?.type)?.price ?? 0), 0);

  const submit = async () => {
    if (!city) return setMsg({ tone: 'error', text: 'Выберите город доставки' });
    setBusy(true);
    setMsg(null);
    setErrors({});
    try {
      const body = {
        recipient,
        variantIds: picked,
        delivery: Object.fromEntries(
          quotes.map((q) => {
            const d = delivery[q.supplierId];
            const pt = points.find((p) => p.code === d.pvzCode);
            return [q.supplierId, d.type === 'pvz' ? { type: 'pvz', cityCode: city.code, city: city.city, pvzCode: d.pvzCode, pvzAddress: pt?.address } : { type: 'courier', cityCode: city.code, city: city.city, street: d.street, flat: d.flat || undefined }];
          }),
        ),
      };
      const r = await api<{ number: string; newAccount: boolean }>(`/admin/premium/${leadId}/order`, body);
      setMsg({ tone: 'success', text: `Заказ № ${r.number} создан, ссылка на оплату отправлена на ${recipient.email}${r.newAccount ? '; создан аккаунт покупателя — ему ушло письмо «задайте пароль»' : ''}.` });
      onCreated();
    } catch (e) {
      if (isApiError(e)) {
        setErrors(Object.fromEntries(Object.entries(e.errors ?? {}).map(([k, v]) => [k.replace(/^recipient\./, ''), v])));
        setMsg({ tone: 'error', text: e.message });
      } else setMsg({ tone: 'error', text: 'Нет связи с сервером' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>Получатель</legend>
        <Field label="Имя и фамилия" value={recipient.name} error={errors.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
        <Field label="Телефон" value={recipient.phone} error={errors.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} />
        <Field
          label="Email для ссылки на оплату"
          type="email"
          value={recipient.email}
          error={errors.email}
          hint={draft.account ? `Заказ будет в аккаунте ${draft.account.email}` : 'Гость: найдём покупателя по email или создадим аккаунт без пароля'}
          onChange={(e) => setRecipient({ ...recipient, email: e.target.value })}
        />
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>Состав (цены и наличие — на сейчас)</legend>
        <div style={{ display: 'grid', gap: 8 }}>
          {draft.items.map((i) => (
            <label key={i.variantId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={picked.includes(i.variantId)}
                disabled={!i.available}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.variantId] : p.filter((x) => x !== i.variantId)))}
              />
              <span>
                {i.title}, {i.color}, {i.size} — {i.price != null ? formatRub(i.price) : '—'}
                {i.price != null && i.price !== i.snapshotPrice && <span className={s.muted}> (в заявке {formatRub(i.snapshotPrice)})</span>}
                <span className={s.muted}> · {i.available ? `${i.supplier?.name}, остаток ${i.stock}` : 'нет в наличии'}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div style={{ position: 'relative' }}>
        <Field
          label="Город доставки"
          value={cityQ}
          autoComplete="off"
          hint={city ? `Код СДЭК ${city.code}` : 'Начните вводить и выберите город из списка'}
          onChange={(e) => {
            setCityQ(e.target.value);
            setCity(null);
          }}
        />
        {cities.length > 0 && (
          <ul id={`${uid}-cities`} aria-label="Подходящие города" className={s.panel} style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 8, listStyle: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
            {cities.slice(0, 8).map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  style={{ background: 'none', border: 0, padding: '6px 8px', width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                  onClick={() => {
                    setCity(c);
                    setCityQ(c.city);
                    setCities([]);
                  }}
                >
                  {c.city} <span className={s.muted}>{c.region}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {quotes.map((q, n) => {
        const d = delivery[q.supplierId];
        if (!d) return null;
        const set = (patch: Partial<Delivery>) => setDelivery((cur) => ({ ...cur, [q.supplierId]: { ...cur[q.supplierId], ...patch } }));
        return (
          <fieldset key={q.supplierId} style={{ border: '1px solid var(--c-border)', borderRadius: 12, padding: 12, margin: 0, display: 'grid', gap: 8 }}>
            <legend style={{ fontWeight: 600, padding: '0 4px' }}>
              Отправление {n + 1}: {supplierName(q.supplierId)}
            </legend>
            {!q.options.length && <span className={s.muted}>СДЭК не доставляет в этот город — выберите другой</span>}
            {q.options.map((o) => (
              <label key={o.type} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="radio" name={`${uid}-${q.supplierId}`} checked={d.type === o.type} onChange={() => set({ type: o.type })} />
                {o.type === 'pvz' ? 'Пункт выдачи СДЭК' : 'Курьер СДЭК'} · {formatRub(o.price)} · {o.periodMin}–{o.periodMax} дн.
              </label>
            ))}
            {d.type === 'pvz' ? (
              <label style={{ display: 'grid', gap: 6 }}>
                <span className={s.muted}>Пункт выдачи</span>
                <select className={s.input} value={d.pvzCode} onChange={(e) => set({ pvzCode: e.target.value })}>
                  <option value="">— выберите —</option>
                  {points.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.address} ({p.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr) 120px' }}>
                <Field label="Улица и дом" value={d.street} onChange={(e) => set({ street: e.target.value })} />
                <Field label="Кв./офис" value={d.flat} onChange={(e) => set({ flat: e.target.value })} />
              </div>
            )}
          </fieldset>
        );
      })}

      <p>
        <b>
          Итого: {formatRub(goods + deliveryTotal)}
        </b>
        <span className={s.muted}>
          {' '}
          · товары {formatRub(goods)}, доставка {formatRub(deliveryTotal)} · резерв и ссылка на оплату — {draft.payHours} ч
        </span>
      </p>
      <div>
        <Button disabled={busy || !picked.length || !city || !quotes.length} onClick={submit}>
          {busy ? 'Создаём…' : 'Создать заказ и отправить ссылку'}
        </Button>
      </div>
    </div>
  );
}
