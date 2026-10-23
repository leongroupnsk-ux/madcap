'use client';

import { ORDER_STATUS_LABEL, SHIPMENT_STATUS_LABEL, cdekTrackUrl, formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Item = { id: string; title: string; sku: string; size: string; color: string; price: number; qty: number; returnedQty: number; image: string | null };
type Shipment = {
  no: number; supplier: string; status: string; deliveryType: string; address: string; trackNo: string | null; cdekUuid: string | null; goodsTotal: number; deliveryPrice: number; commission: number;
  items: Item[]; events: { status: string; note: string | null; at: string }[]; payouts: { kind: string; amountGoods: number; commission: number; transferred: number; createdAt: string }[];
  returns: { status: string; amount: number; reason: string }[];
};
type Order = {
  number: string; status: string; paymentStatus: string; paymentId: string | null; paymentMethod: string | null; createdAt: string; paidAt: string | null; expiresAt: string; cancelReason: string | null;
  goodsTotal: number; deliveryTotal: number; total: number; customer: { email: string; name: string; phone: string; recipientEmail: string; deleted: boolean };
  refunds: { id: string; amount: number; reason: string; status: string; providerRefundId: string | null; createdAt: string }[]; shipments: Shipment[];
};
const when = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const CLOSED = ['delivered', 'cancelled', 'rejected', 'awaiting_payment'];

/** Карточка заказа для поддержки (ТЗ §8): всё о заказе, ручная отмена и возврат, перечитывание платежа. */
export default function AdminOrderPage() {
  const { number } = useParams<{ number: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancel, setCancel] = useState<{ no: number; reason: string } | null>(null);
  const [refund, setRefund] = useState<{ sh: Shipment; qty: Record<string, number>; withDelivery: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Order>(`/admin/orders/${number}`).then(setO).catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, [number]);

  const run = async (fn: () => Promise<Order>) => {
    setBusy(true);
    setError(null);
    try {
      setO(await fn());
      return true;
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!o) return error ? <Alert tone="error">{error}</Alert> : null;
  return (
    <>
      <Link href="/admin/orders" className={s.link}>
        ← К заказам
      </Link>
      <div className={s.head} style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">Заказ</div>
          <h1>№ {o.number}</h1>
          <div className={s.muted}>
            {ORDER_STATUS_LABEL[o.status]} · оплата: {o.paymentStatus}
            {o.paymentMethod && ` · ${o.paymentMethod}`}
            {o.cancelReason && ` · ${o.cancelReason}`}
          </div>
        </div>
        {o.paymentId && (
          <Button variant="outline" disabled={busy} onClick={() => run(() => api<Order>(`/admin/orders/${o.number}/sync-payment`, {}))}>
            Перечитать платёж
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <div className={s.detail} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {o.shipments.map((sh) => (
            <section key={sh.no} className={`${s.panel} ${s.scroll}`}>
              <div className={s.head} style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>
                  {sh.no}. {sh.supplier}
                </h2>
                <div className={s.actions}>
                  <span className={`${s.badge} ${s[`b_s_${sh.status}`] ?? ''}`}>{SHIPMENT_STATUS_LABEL[sh.status]}</span>
                  {o.status === 'paid' && (
                    <Button variant="outline" disabled={busy} onClick={() => setRefund({ sh, qty: {}, withDelivery: false, reason: '' })}>
                      Возврат
                    </Button>
                  )}
                  {!CLOSED.includes(sh.status) && (
                    <Button variant="ghost" disabled={busy} onClick={() => setCancel({ no: sh.no, reason: '' })}>
                      Отменить
                    </Button>
                  )}
                </div>
              </div>
              <p className={s.muted}>
                {sh.deliveryType === 'pvz' ? 'ПВЗ' : 'Курьер'} · {sh.address}
                {sh.trackNo && (
                  <>
                    {' · трек '}
                    <a href={cdekTrackUrl(sh.trackNo)} target="_blank" rel="noreferrer" className={s.link}>
                      {sh.trackNo}
                    </a>
                  </>
                )}
                {sh.cdekUuid && ` · uuid СДЭК ${sh.cdekUuid}`}
              </p>
              <table className={s.table}>
                <tbody>
                  {sh.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.title}
                        <div className={s.muted}>
                          {i.sku} · {i.size} · {i.color}
                        </div>
                      </td>
                      <td>
                        {i.qty} шт.{i.returnedQty > 0 && <div className={s.neg}>возвращено {i.returnedQty}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatRub(i.price * i.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={s.muted} style={{ marginTop: 8 }}>
                Товары {formatRub(sh.goodsTotal)} · доставка {formatRub(sh.deliveryPrice)} · комиссия {formatRub(sh.commission)}
              </p>
              <ul className={s.events} style={{ marginTop: 10 }}>
                {sh.events.map((e, n) => (
                  <li key={n}>
                    <span>
                      {SHIPMENT_STATUS_LABEL[e.status] ?? e.status}
                      {e.note && <span className={s.muted}> · {e.note}</span>}
                    </span>
                    <span className={s.muted}>{when(e.at)}</span>
                  </li>
                ))}
              </ul>
              {sh.payouts.length > 0 && (
                <p className={s.muted} style={{ marginTop: 8 }}>
                  Перечисления поставщику: {sh.payouts.map((p) => `${p.kind === 'sale' ? '+' : ''}${formatRub(p.transferred)}`).join(', ')}
                </p>
              )}
            </section>
          ))}
        </div>
        <div className={s.detailSide}>
          <section className={s.panel}>
            <h2>Покупатель</h2>
            <div className={s.kv}>
              <div>
                <span>Аккаунт</span>
                <b style={{ wordBreak: 'break-all' }}>{o.customer.deleted ? 'удалён' : o.customer.email}</b>
              </div>
              <div>
                <span>Получатель</span>
                <b>{o.customer.name}</b>
              </div>
              <div>
                <span>Телефон</span>
                <a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a>
              </div>
              <div>
                <span>Email для чека</span>
                <span style={{ wordBreak: 'break-all' }}>{o.customer.recipientEmail}</span>
              </div>
            </div>
          </section>
          <section className={s.panel}>
            <h2>Деньги</h2>
            <div className={s.kv}>
              <div>
                <span>Товары</span>
                <b>{formatRub(o.goodsTotal)}</b>
              </div>
              <div>
                <span>Доставка</span>
                <b>{formatRub(o.deliveryTotal)}</b>
              </div>
              <div>
                <span>Итого</span>
                <b>{formatRub(o.total)}</b>
              </div>
              {o.paymentId && <p className={s.muted} style={{ wordBreak: 'break-all' }}>Платёж {o.paymentId}</p>}
            </div>
            {o.refunds.length > 0 && (
              <ul className={s.events} style={{ marginTop: 12 }}>
                {o.refunds.map((r) => (
                  <li key={r.id}>
                    <span>
                      −{formatRub(r.amount)} <span className={s.muted}>· {r.reason}</span>
                    </span>
                    <span className={s.muted}>{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {cancel && (
        <Modal eyebrow={`Отправление ${cancel.no}`} title="Отменить с возвратом денег" onClose={() => setCancel(null)}>
          <p className={s.muted} style={{ marginBottom: 12 }}>
            Покупателю вернутся деньги за товары и доставку. Если посылка уже у СДЭК, отмену заказа в СДЭК и возврат посылки оформите в личном кабинете СДЭК.
          </p>
          <Field label="Причина" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} />
          <div style={{ marginTop: 12 }}>
            <Button disabled={busy || cancel.reason.trim().length < 3} onClick={async () => (await run(() => api<Order>(`/admin/orders/${o.number}/shipments/${cancel.no}/cancel`, { reason: cancel.reason }))) && setCancel(null)}>
              Отменить отправление
            </Button>
          </div>
        </Modal>
      )}

      {refund && (
        <Modal eyebrow={`Отправление ${refund.sh.no}`} title="Частичный возврат" onClose={() => setRefund(null)}>
          <div style={{ display: 'grid', gap: 10 }}>
            {refund.sh.items
              .filter((i) => i.qty > i.returnedQty)
              .map((i) => (
                <label key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                  <input
                    type="number"
                    min={0}
                    max={i.qty - i.returnedQty}
                    className={s.input}
                    style={{ width: 70 }}
                    value={refund.qty[i.id] ?? 0}
                    onChange={(e) => setRefund({ ...refund, qty: { ...refund.qty, [i.id]: Math.max(0, Math.min(i.qty - i.returnedQty, Number(e.target.value))) } })}
                  />
                  {i.title}, {i.size} · {formatRub(i.price)}
                </label>
              ))}
            <label style={{ display: 'flex', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={refund.withDelivery} onChange={(e) => setRefund({ ...refund, withDelivery: e.target.checked })} />
              Вернуть доставку ({formatRub(refund.sh.deliveryPrice)})
            </label>
            <Field label="Причина" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} placeholder="Брак шва" />
            {error && <Alert tone="error">{error}</Alert>}
            <Button
              disabled={busy || refund.reason.trim().length < 3}
              onClick={async () => {
                const items = Object.entries(refund.qty)
                  .filter(([, q]) => q > 0)
                  .map(([itemId, qty]) => ({ itemId, qty }));
                if (await run(() => api<Order>(`/admin/orders/${o.number}/shipments/${refund.sh.no}/refund`, { items, withDelivery: refund.withDelivery, reason: refund.reason }))) setRefund(null);
              }}
            >
              Вернуть деньги
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
