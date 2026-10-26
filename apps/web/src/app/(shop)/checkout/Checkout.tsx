'use client';

import { formatRub, plural, recipientSchema, type AddressInput } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { readCart, writeCart, type CartLine } from '@/lib/cart';
import c from '@/components/shop/checkout.module.css';
import type { CheckedItem } from '../cart/CartView';
import { AddressDrawer, addressText, type DeliveryFeatures, type Quote, type SavedAddress } from './AddressDrawer';

type Group = { supplierId: string; name: string; city: string | null; items: { line: CartLine; item: CheckedItem }[]; goods: number };

const days = (q: Quote) => (q.periodMin === q.periodMax ? `${q.periodMax} ${plural(q.periodMax, 'день', 'дня', 'дней')}` : `${q.periodMin}-${q.periodMax} ${plural(q.periodMax, 'день', 'дня', 'дней')}`);
const typeName = (t: 'pvz' | 'courier') => (t === 'pvz' ? 'Пункт выдачи СДЭК' : 'Курьер СДЭК');
/** «со склада в Москве» — для подписи отправления */
const inCity = (city: string) => (city === 'Москва' ? 'Москве' : city);
const DEFAULT_CITY = 44; // Москва — для предварительной цены, пока адрес не выбран

/**
 * Оформление (ТЗ §6.2) — кадры .Order-step-1 и .Order-step-2.
 * Шаг «Доставка»: карточка на каждое отправление (нумерация 1, 2, 3…), способ и адрес доставки по отправлению, получатель, итог.
 * Шаг «Оплата»: итог заказа и переход на страницу ЮKassa — данные карты на нашем сайте не вводятся (ТЗ §12 п.7).
 */
export function Checkout({
  saved: initialSaved,
  recipient: initialRecipient,
  features,
}: {
  saved: SavedAddress[];
  recipient: { name: string; phone: string; email: string };
  features: DeliveryFeatures;
}) {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [items, setItems] = useState<CheckedItem[] | null>(null);
  const [saved, setSaved] = useState(initialSaved);
  const [delivery, setDelivery] = useState<Record<string, AddressInput>>({});
  const [quotes, setQuotes] = useState<Record<number, Record<string, Quote[]>>>({});
  const [drawer, setDrawer] = useState<{ supplierId: string; type: 'pvz' | 'courier' } | null>(null);
  const [recipient, setRecipient] = useState(initialRecipient);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    const current = readCart();
    setLines(current);
    if (!current.length) return setItems([]);
    api<{ items: CheckedItem[] }>('/cart/check', { lines: current.map(({ variantId, qty, fromCapsule }) => ({ variantId, qty, fromCapsule })) })
      .then((r) => setItems(r.items))
      .catch(() => setMessage('Не удалось загрузить корзину. Обновите страницу.'));
  }, []);

  const groups = useMemo<Group[]>(() => {
    if (!lines || !items) return [];
    const map = new Map<string, Group>();
    for (const line of lines) {
      const item = items.find((i) => i.variantId === line.variantId);
      if (!item || !item.available) continue;
      const g = map.get(item.supplier.id) ?? { supplierId: item.supplier.id, name: item.supplier.name, city: item.supplier.city, items: [], goods: 0 };
      g.items.push({ line, item });
      g.goods += item.price * line.qty;
      map.set(item.supplier.id, g);
    }
    return [...map.values()];
  }, [lines, items]);
  const problems = (items ?? []).filter((i) => !i.available || i.qty > i.stock);

  // Тарифы считаются сразу по всем отправлениям до города; один запрос на город, ответы — в кэше.
  const pending = useRef(new Map<number, Promise<Record<string, Quote[]>>>());
  const loadQuotes = useCallback(
    (city: number) => {
      if (!lines?.length) return Promise.resolve({} as Record<string, Quote[]>);
      let p = pending.current.get(city);
      if (!p) {
        p = api<{ supplierId: string; options: Quote[] }[]>('/checkout/quote', { lines: lines.map(({ variantId, qty }) => ({ variantId, qty })), cityCode: city })
          .then((r) => Object.fromEntries(r.map((x) => [x.supplierId, x.options])))
          .catch(() => ({}));
        pending.current.set(city, p);
        void p.then((res) => setQuotes((q) => ({ ...q, [city]: res })));
      }
      return p;
    },
    [lines],
  );

  const cities = useMemo(() => [...new Set([DEFAULT_CITY, ...(saved[0] ? [saved[0].cityCode] : []), ...Object.values(delivery).map((d) => d.cityCode)])], [delivery, saved]);
  useEffect(() => {
    if (!lines?.length || !items) return;
    for (const city of cities) void loadQuotes(city);
  }, [cities, lines, items, loadQuotes]);

  const drawerSupplier = drawer?.supplierId;
  const quoteFor = useCallback(async (city: number) => (drawerSupplier ? (await loadQuotes(city))[drawerSupplier] : undefined), [loadQuotes, drawerSupplier]);

  const previewCity = saved[0]?.cityCode ?? DEFAULT_CITY;
  const chosen = (g: Group) => {
    const d = delivery[g.supplierId];
    return d ? quotes[d.cityCode]?.[g.supplierId]?.find((q) => q.type === d.type) : undefined;
  };
  const goodsTotal = groups.reduce((s, g) => s + g.goods, 0);
  const goodsCount = groups.reduce((s, g) => s + g.items.reduce((n, x) => n + x.line.qty, 0), 0);
  // Доставка — ровно сумма выбранных тарифов по отправлениям (ТЗ §12)
  const deliveryTotal = groups.reduce((s, g) => s + (chosen(g)?.price ?? 0), 0);
  const allChosen = groups.length > 0 && groups.every((g) => chosen(g));
  const missingTariff = groups.some((g) => delivery[g.supplierId] && quotes[delivery[g.supplierId].cityCode] && !chosen(g));
  const canPay = allChosen && !missingTariff;

  const pick = (a: AddressInput) => {
    setDelivery((d) => ({ ...d, [drawer!.supplierId]: a }));
    setDrawer(null);
  };

  const toPayment = () => {
    const r = recipientSchema.safeParse(recipient);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setMessage(null);
    setStep(2);
    window.scrollTo({ top: 0 });
  };

  async function pay() {
    const r = recipientSchema.safeParse(recipient);
    if (!r.success) return setStep(1);
    setMessage(null);
    setBusy(true);
    try {
      const res = await api<{ number: string; confirmationUrl: string | null }>('/orders', {
        lines: lines!.map(({ variantId, qty, fromCapsule }) => ({ variantId, qty, fromCapsule })),
        recipient: r.data,
        delivery: Object.fromEntries(groups.map((g) => [g.supplierId, delivery[g.supplierId]])),
        saveAddresses: true,
      });
      writeCart([]);
      window.location.href = res.confirmationUrl ?? `/orders/${res.number}/result`;
    } catch (e) {
      setBusy(false);
      if (isApiError(e)) {
        if (e.errors) {
          const errs = Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k.replace(/^recipient\./, ''), v]));
          setErrors(errs);
          if (['name', 'phone', 'email'].some((k) => errs[k])) setStep(1);
        }
        setMessage(e.message);
      } else setMessage('Нет связи с сервером. Попробуйте ещё раз.');
    }
  }

  if (!lines || !items)
    return <section className={c.page}>{message ? <Alert tone="error">{message}</Alert> : <div className={c.spinner} style={{ marginTop: 80 }} />}</section>;

  if (!groups.length || problems.length) {
    return (
      <section className={c.page}>
        <Link href="/cart" className={c.back}>
          ← В корзину
        </Link>
        <div className={c.steps}>
          Корзина — <b>Доставка</b> — Оплата
        </div>
        <h1 className={c.title}>Оформление заказа.</h1>
        <div className={c.empty}>
          <h2>{groups.length ? 'Корзина изменилась.' : 'В корзине пока пусто.'}</h2>
          {groups.length > 0 && <p>Некоторых товаров уже нет в нужном количестве — проверьте корзину.</p>}
          <Link href={groups.length ? '/cart' : '/catalog'} className={c.emptyLink}>
            {groups.length ? 'Вернуться в корзину →' : 'Вернуться к покупкам →'}
          </Link>
        </div>
      </section>
    );
  }

  if (step === 2) {
    return (
      <section className={c.page}>
        <div className={c.payWrap}>
          <div className={c.steps}>
            Корзина — Доставка — <b>Оплата</b>
          </div>
          <div className={c.payCard}>
            <h1 className={c.payTitle}>Оплата</h1>
            <div className={c.payMeta}>
              Магазин: aesculap · {groups.length} {plural(groups.length, 'отправление', 'отправления', 'отправлений')}
            </div>
            <div className={c.payList}>
              {groups.map((g, idx) => {
                const d = delivery[g.supplierId];
                const q = chosen(g)!;
                return (
                  <div key={g.supplierId} className={c.payItem}>
                    <div className={c.payItemHead}>
                      <span>
                        Отправление {idx + 1} · {g.name}
                      </span>
                      <span>{formatRub(q.price)}</span>
                    </div>
                    <div className={c.payItemText}>
                      {typeName(d.type)} · {addressText(d)} · <b>{days(q)}</b>
                    </div>
                  </div>
                );
              })}
              <div className={c.payItem}>
                <div className={c.payItemHead}>Получатель</div>
                <div className={c.payItemText}>
                  {recipient.name} · {recipient.phone} · {recipient.email}
                </div>
              </div>
            </div>
            <div className={c.payTotals}>
              <div>
                <span>Товары · {goodsCount}</span>
                <b>{formatRub(goodsTotal)}</b>
              </div>
              <div>
                <span>Доставка</span>
                <b>{formatRub(deliveryTotal)}</b>
              </div>
              <div className={c.payTotal}>
                <span>Итого</span>
                <span>{formatRub(goodsTotal + deliveryTotal)}</span>
              </div>
            </div>
            {message && <Alert tone="error">{message}</Alert>}
            <button type="button" className={c.primary} onClick={pay} disabled={busy || !canPay}>
              {busy ? 'Создаём платёж…' : `Перейти к оплате · ${formatRub(goodsTotal + deliveryTotal)}`}
            </button>
            <p className={c.legal} style={{ margin: 0 }}>
              Карта или СБП — на защищённой странице ЮKassa, чек придёт на почту. Нажимая «Перейти к оплате», вы соглашаетесь с <Link href="/legal/offer">офертой</Link> и{' '}
              <Link href="/legal/privacy">политикой ПДн</Link>. Возврат — 7 дней.
            </p>
          </div>
          <div className={c.payBack}>
            <button type="button" onClick={() => setStep(1)} disabled={busy}>
              ← Вернуться к доставке
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={c.page}>
      <Link href="/cart" className={c.back}>
        ← В корзину
      </Link>
      <div className={c.steps}>
        Корзина — <b>Доставка</b> — Оплата
      </div>
      <h1 className={c.title}>Оформление заказа.</h1>
      <div className={c.layout}>
        <div className={`${c.main} ${c.shipments}`}>
          {groups.map((g, idx) => {
            const d = delivery[g.supplierId];
            const q = chosen(g);
            const preview = quotes[d?.cityCode ?? previewCity]?.[g.supplierId] ?? quotes[DEFAULT_CITY]?.[g.supplierId];
            const count = g.items.reduce((s, x) => s + x.line.qty, 0);
            return (
              <div key={g.supplierId} className={c.ship}>
                <div className={c.shipHead}>
                  <b>
                    Отправление {idx + 1} · {g.name}
                  </b>
                  <span>
                    {count} {plural(count, 'товар', 'товара', 'товаров')} <b>·</b> {formatRub(g.goods)}
                    {g.city && (
                      <>
                        {' '}
                        <b>·</b> со склада в {inCity(g.city)}
                      </>
                    )}
                  </span>
                </div>
                <div className={c.shipThumbs}>
                  {g.items.map(({ item }) => (item.product.image ? <img key={item.variantId} src={item.product.image} alt={item.product.title} /> : <span key={item.variantId} />))}
                </div>
                <div className={c.options}>
                  {(['pvz', 'courier'] as const).map((type) => {
                    const opt = preview?.find((x) => x.type === type);
                    const active = d?.type === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        className={active ? c.optionOn : c.option}
                        aria-pressed={active}
                        onClick={() => setDrawer({ supplierId: g.supplierId, type })}
                        disabled={preview !== undefined && !opt && !active}
                      >
                        <span className={c.optionHead}>
                          {active ? (
                            <>
                              {typeName(type)}
                              {q && <span className={c.badge}>доставка {formatRub(q.price)}</span>}
                            </>
                          ) : (
                            <>
                              {typeName(type)}
                              {opt ? ` · ${formatRub(opt.price)}` : preview ? ' · недоступно' : ''}
                            </>
                          )}
                        </span>
                        <span className={c.optionText}>
                          {active ? (
                            <>
                              {d.type === 'pvz' ? `${d.city}, ${d.pvzAddress ?? d.pvzCode}` : addressText(d)}
                              {q && <b> · {days(q)}</b>}
                              {!q && quotes[d.cityCode] && <span className={c.warn}>СДЭК не доставляет этим способом в {d.city} — выберите другой адрес.</span>}
                            </>
                          ) : type === 'pvz' ? (
                            'Дата и точная стоимость доставки станет известна после выбора пункта выдачи.'
                          ) : (
                            'Дата и точная стоимость доставки станут известны после выбора адреса доставки.'
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {d && groups.length > 1 && groups.some((x) => !delivery[x.supplierId]) && (
                  <div className={c.shipFoot}>
                    <button
                      type="button"
                      className={c.linkBtn}
                      onClick={() => setDelivery((cur) => Object.fromEntries(groups.map((x) => [x.supplierId, cur[x.supplierId] ?? d])))}
                    >
                      Доставить остальные отправления сюда же
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className={c.aside}>
          <div className={c.card}>
            <h2>Получатель</h2>
            <div className={c.fields}>
              {(
                [
                  ['name', 'Имя и фамилия', 'text', 'name', undefined],
                  ['phone', 'Телефон', 'tel', 'tel', '+7 999 123-45-67'],
                  ['email', 'Email', 'email', 'email', undefined],
                ] as const
              ).map(([k, label, type, ac, ph]) => (
                <label key={k}>
                  <span className={c.srOnly}>{label}</span>
                  <input
                    className={errors[k] ? c.inputError : c.input}
                    type={type}
                    value={recipient[k]}
                    placeholder={ph ?? label}
                    autoComplete={ac}
                    aria-invalid={Boolean(errors[k])}
                    onChange={(e) => setRecipient({ ...recipient, [k]: e.target.value })}
                  />
                  {errors[k] && <div className={c.fieldError}>{errors[k]}</div>}
                </label>
              ))}
            </div>
          </div>

          <div className={c.summary}>
            <div className={c.row}>
              <span>Товары · {goodsCount}</span>
              <b>{formatRub(goodsTotal)}</b>
            </div>
            <div className={c.row}>
              <span>Доставка</span>
              <b>{allChosen || deliveryTotal > 0 ? formatRub(deliveryTotal) : '—'}</b>
            </div>
            <div className={c.total}>
              <span>Итого</span>
              <span>{formatRub(goodsTotal + deliveryTotal)}</span>
            </div>
            {message && (
              <div style={{ marginTop: 16 }}>
                <Alert tone="error">{message}</Alert>
              </div>
            )}
            <button type="button" className={c.accent} onClick={toPayment} disabled={!canPay}>
              Оплатить
            </button>
            {canPay ? <div className={c.summaryNote}>Карта или СБП · чек придет на почту</div> : <div className={c.summaryNote}>Выберите доставку для каждого отправления</div>}
          </div>
          <p className={c.legal} style={{ margin: 0 }}>
            Нажимая «Оплатить», вы соглашаетесь с <Link href="/legal/offer">офертой</Link> и <Link href="/legal/privacy">политикой ПДн</Link>. Возврат — 7 дней.
          </p>
        </div>
      </div>

      {drawer && (
        <AddressDrawer
          initialType={drawer.type}
          features={features}
          saved={saved}
          current={delivery[drawer.supplierId]}
          quoteFor={quoteFor}
          onClose={() => setDrawer(null)}
          onPick={pick}
          onSaved={(a) => setSaved((s) => [a, ...s.filter((x) => x.id !== a.id)])}
          onDelete={(id) => {
            void api(`/me/addresses/${id}`, undefined, 'DELETE');
            setSaved((s) => s.filter((a) => a.id !== id));
          }}
        />
      )}
    </section>
  );
}
