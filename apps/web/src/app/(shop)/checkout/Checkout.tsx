'use client';

import { formatRub, plural, recipientSchema, type AddressInput } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { readCart, writeCart, type CartLine } from '@/lib/cart';
import o from '@/components/shop/order.module.css';
import type { CheckedItem } from '../cart/CartView';
import { AddressDrawer, addressText, type SavedAddress } from './AddressDrawer';

type Quote = { type: 'pvz' | 'courier'; tariffCode: number; price: number; periodMin: number; periodMax: number };
type Group = { supplierId: string; name: string; city: string | null; items: { line: CartLine; item: CheckedItem }[]; goods: number };

const days = (q: Quote) => (q.periodMin === q.periodMax ? `${q.periodMax} ${plural(q.periodMax, 'день', 'дня', 'дней')}` : `${q.periodMin}–${q.periodMax} ${plural(q.periodMax, 'день', 'дня', 'дней')}`);
const DEFAULT_CITY = 44; // Москва — для «от X ₽», пока адрес не выбран

/** Оформление (ТЗ §6.2): по карточке на отправление, способ и адрес доставки, получатель, итог. */
export function Checkout({ saved: initialSaved, recipient: initialRecipient }: { saved: SavedAddress[]; recipient: { name: string; phone: string; email: string } }) {
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

  const cities = useMemo(() => [...new Set([DEFAULT_CITY, ...(saved[0] ? [saved[0].cityCode] : []), ...Object.values(delivery).map((d) => d.cityCode)])], [delivery, saved]);
  useEffect(() => {
    if (!lines?.length || !items) return;
    for (const city of cities) {
      if (quotes[city]) continue;
      api<{ supplierId: string; options: Quote[] }[]>('/checkout/quote', { lines: lines.map(({ variantId, qty }) => ({ variantId, qty })), cityCode: city })
        .then((r) => setQuotes((q) => ({ ...q, [city]: Object.fromEntries(r.map((x) => [x.supplierId, x.options])) })))
        .catch(() => setQuotes((q) => ({ ...q, [city]: {} })));
    }
  }, [cities, lines, items, quotes]);

  const previewCity = saved[0]?.cityCode ?? DEFAULT_CITY;
  const chosen = (g: Group) => {
    const d = delivery[g.supplierId];
    return d ? quotes[d.cityCode]?.[g.supplierId]?.find((q) => q.type === d.type) : undefined;
  };
  const goodsTotal = groups.reduce((s, g) => s + g.goods, 0);
  const deliveryTotal = groups.reduce((s, g) => s + (chosen(g)?.price ?? 0), 0);
  const allChosen = groups.length > 0 && groups.every((g) => chosen(g));
  const missingTariff = groups.some((g) => delivery[g.supplierId] && quotes[delivery[g.supplierId].cityCode] && !chosen(g));

  const pick = (a: AddressInput) => {
    setDelivery((d) => ({ ...d, [drawer!.supplierId]: a }));
    setDrawer(null);
  };

  async function pay() {
    const r = recipientSchema.safeParse(recipient);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
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
        if (e.errors) setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k.replace(/^recipient\./, ''), v])));
        setMessage(e.message);
      } else setMessage('Нет связи с сервером. Попробуйте ещё раз.');
    }
  }

  if (!lines || !items) return <section className={`container ${o.page}`}>{message ? <Alert tone="error">{message}</Alert> : <div className={o.spinner} />}</section>;

  if (!groups.length || problems.length) {
    return (
      <section className={`container ${o.page}`}>
        <div className={o.empty}>
          <h2>{groups.length ? 'Корзина изменилась.' : 'В корзине пока пусто.'}</h2>
          <p className={o.muted} style={{ marginBottom: 12 }}>
            {groups.length ? 'Некоторых товаров уже нет в нужном количестве — проверьте корзину.' : 'Добавьте вещи из каталога или капсулы.'}
          </p>
          <Link href={groups.length ? '/cart' : '/catalog'} className={o.link}>
            {groups.length ? 'Вернуться в корзину →' : 'Вернуться к покупкам →'}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={`container ${o.page}`}>
      <Link href="/cart" className={o.back}>
        ← Вернуться в корзину
      </Link>
      <div className={o.steps} style={{ marginTop: 16 }}>
        Корзина — <b>Доставка</b> — Оплата
      </div>
      <h1 className={o.title}>Как доставить?</h1>
      <div className={o.layout}>
        <div className={o.stack}>
          {groups.map((g, idx) => {
            const d = delivery[g.supplierId];
            const q = chosen(g);
            const preview = quotes[d?.cityCode ?? previewCity]?.[g.supplierId] ?? quotes[DEFAULT_CITY]?.[g.supplierId];
            const count = g.items.reduce((s, x) => s + x.line.qty, 0);
            return (
              <div key={g.supplierId} className={o.panel}>
                <div className={o.panelHead}>
                  <h3>
                    Отправление {idx + 1} · {g.name}
                  </h3>
                </div>
                <p className={o.muted} style={{ marginBottom: 10 }}>
                  {count} {plural(count, 'товар', 'товара', 'товаров')} · {formatRub(g.goods)}
                  {g.city && ` · со склада в ${g.city}`}
                </p>
                <div className={o.thumbs}>
                  {g.items.map(({ item }) => (item.product.image ? <img key={item.variantId} src={item.product.image} alt={item.product.title} /> : <span key={item.variantId} />))}
                </div>
                <div className={o.options}>
                  {(['pvz', 'courier'] as const).map((type) => {
                    const opt = preview?.find((x) => x.type === type);
                    const active = d?.type === type;
                    return (
                      <button key={type} type="button" className={active ? o.optionOn : o.option} onClick={() => setDrawer({ supplierId: g.supplierId, type })} disabled={preview !== undefined && !opt}>
                        <b>{type === 'pvz' ? 'Пункт выдачи СДЭК' : 'Курьер СДЭК'}</b>
                        <span className={o.muted}>
                          {active && q ? `${formatRub(q.price)} · ${days(q)}` : opt ? `от ${formatRub(opt.price)}` : preview ? 'Недоступно' : 'Считаем…'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {d && (
                  <div className={o.addr}>
                    <span>
                      {d.type === 'pvz' ? 'ПВЗ: ' : 'Адрес: '}
                      {addressText(d)}
                      {q && <div className={o.muted}>Срок {days(q)} · ориентировочно {new Date(Date.now() + q.periodMax * 86400000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>}
                      {!q && quotes[d.cityCode] && <div className={o.warn}>СДЭК не доставляет этим способом в {d.city}</div>}
                    </span>
                    <span className={o.actions}>
                      <button type="button" className={o.link} onClick={() => setDrawer({ supplierId: g.supplierId, type: d.type })}>
                        Изменить
                      </button>
                      {groups.length > 1 && (
                        <button type="button" className={o.link} onClick={() => setDelivery(Object.fromEntries(groups.map((x) => [x.supplierId, d])))}>
                          Доставить всё сюда
                        </button>
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          <div className={o.panel}>
            <div className={o.panelHead}>
              <h3>Получатель</h3>
            </div>
            <div className={o.grid3}>
              <Field label="Имя и фамилия *" value={recipient.name} error={errors.name} autoComplete="name" onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
              <Field label="Телефон *" type="tel" value={recipient.phone} error={errors.phone} placeholder="+7 999 123-45-67" autoComplete="tel" onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} hint="Для СДЭК" />
              <Field label="Email *" type="email" value={recipient.email} error={errors.email} autoComplete="email" onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} hint="Для чека" />
            </div>
          </div>
        </div>

        <aside className={o.summary}>
          <h2>Ваш заказ</h2>
          <div className={o.row}>
            <span>Товары · {groups.reduce((s, g) => s + g.items.reduce((n, x) => n + x.line.qty, 0), 0)}</span>
            <b>{formatRub(goodsTotal)}</b>
          </div>
          <div className={o.row}>
            <span>
              Доставка · {groups.length} {plural(groups.length, 'отправление', 'отправления', 'отправлений')}
            </span>
            <b>{allChosen ? formatRub(deliveryTotal) : '—'}</b>
          </div>
          <div className={o.total}>
            <span>Итого</span>
            <b>{formatRub(goodsTotal + deliveryTotal)}</b>
          </div>
          {message && <Alert tone="error">{message}</Alert>}
          <Button variant="accent" onClick={pay} disabled={!allChosen || missingTariff || busy}>
            {busy ? 'Создаём платёж…' : 'Оплатить'}
          </Button>
          {!allChosen && <div className={o.small}>Выберите доставку для каждого отправления.</div>}
          <div className={o.small}>
            Карта или СБП · чек придёт на почту. Нажимая «Оплатить», вы соглашаетесь с <Link href="/legal/offer">офертой</Link> и{' '}
            <Link href="/legal/privacy">обработкой персональных данных</Link>. Возврат — 7 дней после получения.
          </div>
        </aside>
      </div>

      {drawer && (
        <AddressDrawer
          initialType={drawer.type}
          saved={saved}
          onClose={() => setDrawer(null)}
          onPick={pick}
          onDelete={(id) => {
            void api(`/me/addresses/${id}`, undefined, 'DELETE');
            setSaved((s) => s.filter((a) => a.id !== id));
          }}
        />
      )}
    </section>
  );
}
