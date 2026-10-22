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

  return (
    <>
      <Link href="/supplier/orders" className={s.link}>
        ← К заказам
      </Link>
      <div className={s.head} style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">Отправление</div>
          <h1>№ {d.number}</h1>
          <div style={{ marginTop: 8 }}>
            <StatusBadge status={d.status} overdue={d.overdue} />
          </div>
        </div>
        <div className={s.actions}>
          {['new', 'confirmed'].includes(d.status) && (
            <Button variant="ghost" disabled={busy} onClick={() => setReject({ kind: 'order', id: d.id })}>
              Отклонить
            </Button>
          )}
          {next && (
            <Button disabled={busy} onClick={() => run(`/supplier/orders/${d.id}/${next[0]}`)}>
              {busy && next[0] === 'waybill' ? 'Создаём накладную…' : next[1]}
            </Button>
          )}
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {d.overdue && <Alert tone="error">Заказ ждёт подтверждения больше суток. Неподтверждённый за 48 часов заказ отменяется с возвратом денег покупателю.</Alert>}
      {d.status === 'rejected' && d.rejectReason && <Alert tone="error">Вы отклонили заказ: {d.rejectReason}</Alert>}

      <div className={s.detail} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <section className={`${s.panel} ${s.scroll}`}>
            <h2>Товары</h2>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Артикул</th>
                  <th>Размер</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {i.image ? <img src={i.image} alt="" className={s.thumb} /> : <span className={s.thumb} />}
                        <span>
                          {i.title}
                          <div className={s.muted}>{i.color}</div>
                        </span>
                      </div>
                    </td>
                    <td className={s.muted}>{i.sku}</td>
                    <td>
                      {i.size}
                      {i.heightRange && ` · ${i.heightRange}`}
                    </td>
                    <td>
                      {i.qty}
                      {i.returnedQty > 0 && <div className={s.neg}>возврат {i.returnedQty}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatRub(i.price * i.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {d.returns.length > 0 && (
            <section className={s.panel}>
              <h2>Возвраты</h2>
              {d.returns.map((r) => (
                <div key={r.id} style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                  <div>
                    <span className={`${s.badge} ${s[`b_${r.status === 'requested' ? 'requested' : r.status === 'approved' ? 'approved' : 'rejected'}`]}`}>
                      {r.status === 'requested' ? 'Ждёт решения' : r.status === 'approved' ? 'Принят, деньги возвращены' : 'Отклонён'}
                    </span>{' '}
                    <span className={s.muted}>{when(r.createdAt)}</span>
                  </div>
                  <div>{r.items.map((x) => `${x.title} × ${x.qty}`).join(', ')} · {formatRub(r.amount)}</div>
                  <div className={s.muted}>Причина покупателя: {r.reason}</div>
                  {r.rejectReason && <div className={s.muted}>Ваш ответ: {r.rejectReason}</div>}
                </div>
              ))}
              {pending && (
                <div className={s.actions}>
                  <Button disabled={busy} onClick={() => run(`/supplier/returns/${pending.id}/approve`)}>
                    Принять возврат и вернуть {formatRub(pending.amount)}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setReject({ kind: 'return', id: pending.id })}>
                    Отказать
                  </Button>
                </div>
              )}
            </section>
          )}

          <section className={s.panel}>
            <h2>История</h2>
            <ul className={s.events}>
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

        <div className={s.detailSide}>
          <section className={s.panel}>
            <h2>Сумма</h2>
            <div className={s.kv}>
              <div>
                <span>Товары</span>
                <b>{formatRub(d.goodsTotal)}</b>
              </div>
              <div>
                <span>Комиссия {d.commissionBp / 100}%</span>
                <b className={s.neg}>−{formatRub(d.commission)}</b>
              </div>
              <div>
                <span>Вам перечислено</span>
                <b>{formatRub(d.goodsTotal - d.commission)}</b>
              </div>
            </div>
          </section>
          <section className={s.panel}>
            <h2>Клиент</h2>
            <div className={s.kv}>
              <div>
                <span>Имя</span>
                <b>{d.customer.name}</b>
              </div>
              {d.customer.phone && (
                <div>
                  <span>Телефон</span>
                  <a href={`tel:${d.customer.phone}`}>{d.customer.phone}</a>
                </div>
              )}
              {d.customer.email && (
                <div>
                  <span>Email</span>
                  <span style={{ color: 'inherit', wordBreak: 'break-all' }}>{d.customer.email}</span>
                </div>
              )}
            </div>
            {!d.customer.phone && <p className={s.muted} style={{ marginTop: 8 }}>Контакты скрыты после завершения заказа.</p>}
          </section>
          <section className={s.panel}>
            <h2>Доставка СДЭК</h2>
            <div className={s.kv}>
              <div>
                <span>Способ</span>
                <b>{d.deliveryType === 'pvz' ? 'Пункт выдачи' : 'Курьер'}</b>
              </div>
              <p style={{ fontSize: 14 }}>{d.address}</p>
              {d.eta && (
                <div>
                  <span>Ожидаемая доставка</span>
                  <b>{new Date(d.eta).toLocaleDateString('ru-RU')}</b>
                </div>
              )}
              {d.trackNo && (
                <div>
                  <span>Трек</span>
                  <a href={cdekTrackUrl(d.trackNo)} target="_blank" rel="noreferrer" className={s.link}>
                    {d.trackNo} ↗
                  </a>
                </div>
              )}
            </div>
            {d.hasWaybill && (
              <div className={s.actions} style={{ marginTop: 12 }}>
                <a className={s.link} href={`/api/supplier/orders/${d.id}/documents/waybill`}>
                  Накладная PDF
                </a>
                <a className={s.link} href={`/api/supplier/orders/${d.id}/documents/barcode`}>
                  Этикетка PDF
                </a>
              </div>
            )}
          </section>
        </div>
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
