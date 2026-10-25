'use client';

import { SHIPMENT_STATUS_LABEL, cdekTrackUrl, formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { NEXT_ACTION, StatusBadge } from '../OrdersTable';

type Detail = {
  id: string; number: string; status: string; createdAt: string; paidAt: string | null; overdue: boolean; goodsTotal: number; commission: number; commissionBp: number;
  deliveryType: 'pvz' | 'courier'; address: string; deliveryPrice: number; eta: string | null; trackNo: string | null; hasWaybill: boolean; rejectReason: string | null;
  customer: { name: string; phone: string | null; email: string | null };
  items: { id: string; sku: string; title: string; size: string; heightRange: string | null; color: string; price: number; qty: number; returnedQty: number; image: string | null }[];
  events: { status: string; note: string | null; at: string }[];
  returns: { id: string; status: string; amount: number; reason: string; rejectReason: string | null; createdAt: string; items: { itemId: string; qty: number; title: string }[] }[];
};

const EVENT_LABEL: Record<string, string> = { ...SHIPMENT_STATUS_LABEL, track: 'Трек-номер', return_requested: 'Запрошен возврат', return_approved: 'Возврат принят', return_rejected: 'Возврат отклонён' };
const when = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Детали отправления в кабинете поставщика (ТЗ §7.5). */
export function ShipmentDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState<{ kind: 'order' | 'return'; id: string } | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    api<Detail>(`/supplier/orders/${id}`)
      .then(setD)
      .catch((e) => setError(isApiError(e) ? e.message : 'Не удалось загрузить заказ'));
  }, [id]);

  const run = async (path: string, body: object = {}) => {
    setBusy(true);
    setError(null);
    try {
      setD(await api<Detail>(path, body));
      return true;
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!d) return error ? <Alert tone="error">{error}</Alert> : null;
  const next = NEXT_ACTION[d.status];
  const pending = d.returns.find((r) => r.status === 'requested');

  const count = d.items.reduce((n, i) => n + i.qty, 0);
  return (
    <>
      <Link href="/supplier/orders" className={s.back}>
        ← К заказам
      </Link>
      <div className={`${s.head} ${s.detailHead}`}>
        <div>
          <div className="eyebrow">Детали заказа</div>
          <div className={s.titleRow}>
            <h1>{d.number}</h1>
            <StatusBadge status={d.status} overdue={d.overdue} />
          </div>
        </div>
        <div className={s.actions}>
          {['new', 'confirmed'].includes(d.status) && (
            <Button variant="ghost" className={s.rowBtn} disabled={busy} onClick={() => setReject({ kind: 'order', id: d.id })}>
              Отклонить
            </Button>
          )}
          {next && (
            <Button className={`${s.rowBtn} ${s.rowBtnWide}`} disabled={busy} onClick={() => run(`/supplier/orders/${d.id}/${next[0]}`)}>
              {busy && next[0] === 'waybill' ? 'Создаём накладную…' : next[1]}
            </Button>
          )}
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {d.overdue && <div className={s.notice}>Заказ ждёт подтверждения больше суток. Неподтверждённый за 48 часов заказ отменяется с возвратом денег покупателю.</div>}
      {d.status === 'rejected' && d.rejectReason && <div className={s.notice}>Вы отклонили заказ: {d.rejectReason}</div>}

      {/* Кадр .Partner-Orders-Order: слева состав и итог, справа клиент (мятная) и доставка (тёмная) */}
      <div className={s.orderGrid}>
        <div className={s.orderMain}>
          <section className={s.panel}>
            <div className="eyebrow">Товары · {count}</div>
            <ul className={s.orderItems}>
              {d.items.map((i) => (
                <li key={i.id}>
                  {i.image ? <img src={i.image} alt="" className={s.orderThumb} /> : <span className={s.orderThumb} />}
                  <div className={s.orderItemText}>
                    <b>{i.title}</b>
                    <span>
                      Артикул {i.sku} · Размер {i.size}
                      {i.heightRange && ` (${i.heightRange})`}
                      {i.color && ` · ${i.color}`} · {i.qty} шт.
                    </span>
                    {i.returnedQty > 0 && <span className={s.neg}>Возвращено: {i.returnedQty} шт.</span>}
                  </div>
                  <strong>{formatRub(i.price * i.qty)}</strong>
                </li>
              ))}
            </ul>
            <div className={s.orderTotal}>
              <span>Итого</span>
              <span>{formatRub(d.goodsTotal)}</span>
            </div>
            <div className={s.orderFees}>
              <div>
                <span>Комиссия {d.commissionBp / 100}%</span>
                <span className={s.neg}>−{formatRub(d.commission)}</span>
              </div>
              <div>
                <span>Вам будет перечислено</span>
                <b>{formatRub(d.goodsTotal - d.commission)}</b>
              </div>
            </div>
          </section>

          {d.returns.length > 0 && (
            <section className={s.panel}>
              <div className="eyebrow">Возвраты</div>
              <div className={s.orderSection}>
                {d.returns.map((r) => (
                  <div key={r.id} className={s.returnRow}>
                    <div>
                      <span className={`${s.badge} ${s[`b_${r.status === 'requested' ? 'requested' : r.status === 'approved' ? 'approved' : 'rejected'}`]}`}>
                        {r.status === 'requested' ? 'Ждёт решения' : r.status === 'approved' ? 'Принят, деньги возвращены' : 'Отклонён'}
                      </span>{' '}
                      <span className={s.muted}>{when(r.createdAt)}</span>
                    </div>
                    <div>
                      {r.items.map((x) => `${x.title} × ${x.qty}`).join(', ')} · <b>{formatRub(r.amount)}</b>
                    </div>
                    <div className={s.muted}>Причина покупателя: {r.reason}</div>
                    {r.rejectReason && <div className={s.muted}>Ваш ответ: {r.rejectReason}</div>}
                  </div>
                ))}
                {pending && (
                  <div className={s.actions}>
                    <Button className={s.rowBtn} disabled={busy} onClick={() => run(`/supplier/returns/${pending.id}/approve`)}>
                      Принять возврат и вернуть {formatRub(pending.amount)}
                    </Button>
                    <Button className={s.rowBtn} variant="outline" disabled={busy} onClick={() => setReject({ kind: 'return', id: pending.id })}>
                      Отказать
                    </Button>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className={s.panel}>
            <div className="eyebrow">История</div>
            <ul className={`${s.events} ${s.orderSection}`}>
              {d.events.map((e, i) => (
                <li key={i}>
                  <span>
                    {EVENT_LABEL[e.status] ?? e.status}
                    {e.note && <span className={s.muted}> · {e.note}</span>}
                  </span>
                  <span className={s.muted}>{when(e.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className={s.orderSide}>
          <section className={s.mintCard}>
            <div className="eyebrow">Клиент</div>
            <p className={s.cardTitle}>{d.customer.name}</p>
            {d.customer.phone || d.customer.email ? (
              <p className={s.cardText}>
                {d.customer.phone && <a href={`tel:${d.customer.phone}`}>{d.customer.phone}</a>}
                {d.customer.phone && d.customer.email && <br />}
                {d.customer.email && <span className={s.breakAll}>{d.customer.email}</span>}
              </p>
            ) : (
              <p className={s.cardText}>Контакты скрыты после завершения заказа.</p>
            )}
          </section>
          <section className={s.darkCard}>
            <div className="eyebrow">Доставка</div>
            <p className={s.cardMain}>
              {d.deliveryType === 'pvz' ? 'ПВЗ СДЭК' : 'Курьер СДЭК'} · {d.address}
            </p>
            {d.eta && <p className={s.cardText}>Ожидаемая дата: {new Date(d.eta).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>}
            {d.trackNo && (
              <p className={s.cardText}>
                Трек:{' '}
                <a href={cdekTrackUrl(d.trackNo)} target="_blank" rel="noreferrer">
                  {d.trackNo} ↗
                </a>
              </p>
            )}
            {d.hasWaybill && (
              <div className={s.cardLinks}>
                <a href={`/api/supplier/orders/${d.id}/documents/waybill`}>Накладная PDF</a>
                <a href={`/api/supplier/orders/${d.id}/documents/barcode`}>Этикетка PDF</a>
              </div>
            )}
          </section>
        </aside>
      </div>

      {reject && (
        <Modal eyebrow={`№ ${d.number}`} title={reject.kind === 'order' ? 'Отклонить заказ' : 'Отказать в возврате'} onClose={() => setReject(null)}>
          <p className={s.muted} style={{ marginBottom: 12 }}>
            {reject.kind === 'order' ? 'Покупателю вернутся деньги за товары и доставку этого отправления, резерв снимется.' : 'Покупатель увидит причину отказа в заказе.'}
          </p>
          <Field label="Причина" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reject.kind === 'order' ? 'Нет в наличии' : 'Товар был в использовании'} maxLength={500} />
          {error && <Alert tone="error">{error}</Alert>}
          <div className={s.actions} style={{ marginTop: 14 }}>
            <Button
              disabled={busy}
              onClick={async () => {
                const ok = await run(reject.kind === 'order' ? `/supplier/orders/${reject.id}/reject` : `/supplier/returns/${reject.id}/reject`, { reason });
                if (ok) {
                  setReject(null);
                  setReason('');
                }
              }}
            >
              {reject.kind === 'order' ? 'Отклонить и вернуть деньги' : 'Отказать'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
