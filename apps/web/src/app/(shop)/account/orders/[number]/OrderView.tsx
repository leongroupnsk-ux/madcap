'use client';

import { ORDER_STATUS_LABEL, RETURN_DAYS, SHIPMENT_FLOW, SHIPMENT_STATUS_LABEL, cdekTrackUrl, formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { addToCart } from '@/lib/cart';
import o from '@/components/shop/order.module.css';

type Item = { id: string; variantId: string | null; slug: string | null; title: string; brand: string; size: string; heightRange: string | null; color: string; price: number; qty: number; returnedQty: number; image: string | null };
type Shipment = {
  no: number; supplier: string; status: string; deliveryType: 'pvz' | 'courier'; address: string; deliveryPrice: number; eta: string | null; trackNo: string | null; goodsTotal: number;
  rejectReason: string | null; canReturn: boolean; returns: { id: string; status: string; amount: number; reason: string; rejectReason: string | null }[];
  events: { status: string; note: string | null; at: string }[]; items: Item[];
};
export type OrderData = {
  number: string; status: string; paymentStatus: string; paymentMethod: string | null; createdAt: string; eta: string | null; cancelReason: string | null;
  goodsTotal: number; deliveryTotal: number; total: number; refunded: number; canCancel: boolean;
  recipient: { name: string; phone: string; email: string }; shipments: Shipment[];
};

const date = (d: string | null, time = false) =>
  d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'long', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '—';

export function orderLabel(o: { status: string; shipments: { status: string }[] }) {
  if (o.status !== 'paid') return ORDER_STATUS_LABEL[o.status] ?? o.status;
  const live = o.shipments.filter((s) => !['cancelled', 'rejected'].includes(s.status));
  if (live.length && live.every((s) => s.status === 'delivered')) return 'Доставлен';
  if (live.some((s) => ['handed_over', 'in_transit', 'ready_for_pickup'].includes(s.status))) return 'В доставке';
  return 'Оплачен';
}
const RETURN_LABEL: Record<string, string> = { requested: 'Возврат на рассмотрении', approved: 'Возврат принят, деньги возвращены', rejected: 'Возврат отклонён' };

/** Детали заказа покупателя (ТЗ §6.6). */
export function OrderView({ initial }: { initial: OrderData }) {
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [ret, setRet] = useState<Shipment | null>(null);
  const [retQty, setRetQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<OrderData | void>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r) setOrder(r);
      return true;
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const label = orderLabel(order);
  const tone = order.status === 'cancelled' ? o.statusBad : order.status === 'pending_payment' ? o.statusWarn : o.status;
  const repeat = () => {
    for (const s of order.shipments) for (const i of s.items) if (i.variantId) addToCart(i.variantId, i.qty);
    router.push('/cart');
  };

  return (
    <section className={`container ${o.page}`}>
      <Link href="/account" className={o.back}>
        ← Назад к профилю
      </Link>
      <div className={o.panelHead} style={{ marginTop: 16 }}>
        <h1 className={o.title} style={{ margin: 0 }}>
          Заказ № {order.number}
        </h1>
        <span className={tone}>{label}</span>
      </div>
      <p className={o.muted} style={{ marginBottom: 20 }}>
        Отмена возможна до передачи в доставку; возврат — {RETURN_DAYS} дней после получения.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {order.status === 'pending_payment' && (
        <Alert tone="error">
          Заказ ждёт оплаты.{' '}
          <button className={o.link} onClick={() => run(async () => void (window.location.href = (await api<{ confirmationUrl: string | null }>(`/orders/${order.number}/pay`, {})).confirmationUrl ?? `/orders/${order.number}/result`))}>
            Оплатить →
          </button>
        </Alert>
      )}

      <div className={o.facts} style={{ marginTop: 16 }}>
        <div className={o.fact}>
          <span>Дата заказа</span>
          {date(order.createdAt, true)}
        </div>
        <div className={o.fact}>
          <span>Ожидаемая доставка</span>
          {order.status === 'cancelled' ? '—' : date(order.eta)}
        </div>
        <div className={o.fact}>
          <span>Оплата</span>
          {order.paymentMethod ?? (order.status === 'pending_payment' ? 'Не оплачен' : '—')}
        </div>
      </div>

      <div className={o.layout}>
        <div className={o.stack}>
          {order.shipments.map((s) => {
            const idx = SHIPMENT_FLOW.indexOf(s.status as (typeof SHIPMENT_FLOW)[number]);
            const at = (st: string) => s.events.find((e) => e.status === st)?.at ?? null;
            const off = s.status === 'cancelled' || s.status === 'rejected';
            return (
              <div key={s.no} className={o.panel}>
                <div className={o.panelHead}>
                  <h3>
                    Отправление {s.no} · {s.supplier}
                  </h3>
                  <span className={off ? o.statusBad : o.status}>{SHIPMENT_STATUS_LABEL[s.status]}</span>
                </div>
                <p className={o.muted}>
                  {s.deliveryType === 'pvz' ? 'Пункт выдачи СДЭК' : 'Курьер СДЭК'} · {s.address}
                </p>
                {s.trackNo && (
                  <p style={{ fontSize: 14, marginTop: 6 }}>
                    Трек СДЭК:{' '}
                    <a href={cdekTrackUrl(s.trackNo)} target="_blank" rel="noreferrer" className={o.link}>
                      {s.trackNo} ↗
                    </a>
                  </p>
                )}
                {off ? (
                  <Alert tone="error">
                    {s.status === 'rejected' ? `Поставщик отклонил заказ: ${s.rejectReason}` : (s.events.at(-1)?.note ?? 'Отправление отменено')}
                    {order.paymentMethod && '. Деньги за отправление возвращены.'}
                  </Alert>
                ) : (
                  order.status !== 'pending_payment' && (
                    <ol className={o.timeline}>
                      {SHIPMENT_FLOW.filter((st) => st !== 'ready_for_pickup' || s.deliveryType === 'pvz').map((st, i) => (
                        <li key={st} className={i <= idx ? o.done : undefined}>
                          <span>
                            {SHIPMENT_STATUS_LABEL[st]}
                            {st === 'handed_over' && s.trackNo && ` · ${s.trackNo}`}
                          </span>
                          <span className={o.muted}>{at(st) ? date(at(st), true) : ''}</span>
                        </li>
                      ))}
                    </ol>
                  )
                )}
                {s.items.map((i) => (
                  <div key={i.id} className={o.line}>
                    {i.image ? <img src={i.image} alt="" className={o.thumb} /> : <span className={o.thumb} />}
                    <div style={{ minWidth: 0 }}>
                      <div className={o.meta}>
                        {i.brand} · {i.size}
                        {i.heightRange && ` · ${i.heightRange}`} · {i.color}
                      </div>
                      {i.slug ? (
                        <Link href={`/product/${i.slug}`} className={o.name}>
                          {i.title}
                        </Link>
                      ) : (
                        <span className={o.name}>{i.title}</span>
                      )}
                      {i.returnedQty > 0 && <div className={o.warn}>Возвращено: {i.returnedQty} шт.</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className={o.price}>{formatRub(i.price * i.qty)}</div>
                      <div className={o.muted}>
                        {i.qty} × {formatRub(i.price)}
                      </div>
                    </div>
                  </div>
                ))}
                {s.returns.map((r) => (
                  <p key={r.id} className={o.muted} style={{ marginTop: 8 }}>
                    {RETURN_LABEL[r.status]} · {formatRub(r.amount)}
                    {r.rejectReason && ` · ${r.rejectReason}`}
                  </p>
                ))}
                {s.canReturn && !s.returns.some((r) => r.status === 'requested') && (
                  <button
                    className={o.link}
                    style={{ marginTop: 10 }}
                    onClick={() => {
                      setRet(s);
                      setRetQty(Object.fromEntries(s.items.map((i) => [i.id, 0])));
                      setReason('');
                    }}
                  >
                    Оформить возврат
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <aside className={o.summary}>
          <h2>Итог</h2>
          <div className={o.row}>
            <span>Товары</span>
            <b>{formatRub(order.goodsTotal)}</b>
          </div>
          <div className={o.row}>
            <span>Доставка</span>
            <b>{formatRub(order.deliveryTotal)}</b>
          </div>
          {order.refunded > 0 && (
            <div className={o.row}>
              <span>Возвращено</span>
              <b>−{formatRub(order.refunded)}</b>
            </div>
          )}
          <div className={o.total}>
            <span>Итого</span>
            <b>{formatRub(order.total)}</b>
          </div>
          <div className={o.small}>
            Получатель: {order.recipient.name}
            <br />
            {order.recipient.phone} · {order.recipient.email}
            <br />
            Чек отправлен на почту.
          </div>
          <Button variant="accent" onClick={repeat}>
            Повторить заказ
          </Button>
          {order.canCancel && (
            <Button variant="ghost" style={{ color: '#fff' }} onClick={() => setConfirmCancel(true)}>
              × Отменить заказ
            </Button>
          )}
        </aside>
      </div>

      {confirmCancel && (
        <Modal eyebrow={`Заказ № ${order.number}`} title="Отменить заказ?" onClose={() => setConfirmCancel(false)}>
          <p style={{ marginBottom: 16 }}>
            {order.status === 'pending_payment'
              ? 'Заказ не оплачен — резерв товаров снимется.'
              : 'Отменятся отправления, которые ещё не переданы в доставку. Деньги за них вернутся на карту или счёт СБП.'}
          </p>
          <div className={o.actions}>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await run(() => api<OrderData>(`/orders/${order.number}/cancel`, {}))) setConfirmCancel(false);
              }}
            >
              Да, отменить
            </Button>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Не отменять
            </Button>
          </div>
        </Modal>
      )}

      {ret && (
        <Modal eyebrow={`Отправление ${ret.no}`} title="Оформить возврат" onClose={() => setRet(null)}>
          <p className={o.muted} style={{ marginBottom: 12 }}>
            Выберите вещи и количество. Поставщик рассмотрит заявку, деньги за товары вернутся тем же способом оплаты. Доставка не возвращается.
          </p>
          {ret.items
            .filter((i) => i.qty > i.returnedQty)
            .map((i) => (
              <div key={i.id} className={o.addr} style={{ alignItems: 'center' }}>
                <span>
                  {i.title}, {i.size} · {formatRub(i.price)}
                </span>
                <span className={o.qty}>
                  <button aria-label="Меньше" onClick={() => setRetQty({ ...retQty, [i.id]: Math.max(0, (retQty[i.id] ?? 0) - 1) })}>
                    −
                  </button>
                  <span>{retQty[i.id] ?? 0}</span>
                  <button aria-label="Больше" onClick={() => setRetQty({ ...retQty, [i.id]: Math.min(i.qty - i.returnedQty, (retQty[i.id] ?? 0) + 1) })}>
                    +
                  </button>
                </span>
              </div>
            ))}
          <div style={{ marginTop: 14 }}>
            <Field label="Причина возврата" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Не подошёл размер" maxLength={500} />
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div style={{ marginTop: 14 }}>
            <Button
              disabled={busy}
              onClick={async () => {
                const items = Object.entries(retQty)
                  .filter(([, q]) => q > 0)
                  .map(([itemId, qty]) => ({ itemId, qty }));
                if (await run(() => api<OrderData>(`/orders/${order.number}/shipments/${ret.no}/return`, { items, reason }))) setRet(null);
              }}
            >
              Отправить заявку
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
