'use client';

import { ORDER_STATUS_LABEL, SHIPMENT_STATUS_LABEL, formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Chip } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Row = { number: string; createdAt: string; status: string; paymentStatus: string; total: number; customer: string; email: string; shipments: { no: number; status: string; supplier: string }[] };
type Rec = { checked: number; ok: number; mismatches: { number: string; problem: string }[] };
const FILTERS = [['', 'Все'], ['problem', 'Требуют внимания'], ['pending_payment', 'Ждут оплаты'], ['paid', 'Оплачены'], ['cancelled', 'Отменены']] as const;

/** Заказы и платежи (ТЗ §8): поиск по номеру, email, телефону, имени и треку; сверка с ЮKassa. */
export default function AdminOrdersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [rec, setRec] = useState<Rec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Row[]>(`/admin/orders?q=${encodeURIComponent(q)}&status=${status}`)
      .then(setRows)
      .catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, [q, status]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Заказы и платежи</h1>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setRec(await api<Rec>('/admin/orders/reconcile'));
            } catch (e) {
              setError(isApiError(e) ? e.message : 'Ошибка');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Сверяем…' : 'Сверка с ЮKassa за 2 дня'}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {rec && (
        <Alert tone={rec.mismatches.length ? 'error' : 'success'}>
          Проверено платежей: {rec.checked}, совпадают: {rec.ok}.
          {rec.mismatches.map((m) => (
            <div key={m.number}>
              <Link href={`/admin/orders/${m.number}`}>№ {m.number}</Link> — {m.problem}
            </div>
          ))}
        </Alert>
      )}
      <div className={s.chips} style={{ marginTop: 12 }}>
        {FILTERS.map(([v, l]) => (
          <Chip key={v} active={status === v} onClick={() => setStatus(v)}>
            {l}
          </Chip>
        ))}
      </div>
      <div className={s.filters}>
        <input className={s.input} style={{ flex: '1 1 300px', maxWidth: 420 }} placeholder="Номер, email, телефон, имя или трек СДЭК" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
      </div>
      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Покупатель</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Отправления</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.number}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/orders/${o.number}`} className={s.link}>
                    № {o.number}
                  </Link>
                  <div className={s.muted}>{new Date(o.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </td>
                <td>
                  {o.customer}
                  <div className={s.muted}>{o.email}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatRub(o.total)}</td>
                <td>{ORDER_STATUS_LABEL[o.status]}</td>
                <td className={s.muted}>
                  {o.shipments.map((sh) => (
                    <div key={sh.no}>
                      {sh.no}. {sh.supplier} — {SHIPMENT_STATUS_LABEL[sh.status]}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className={s.muted} style={{ padding: 24 }}>Заказов не найдено.</p>}
      </div>
    </>
  );
}
