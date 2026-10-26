'use client';

import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { NEXT_ACTION, StatusBadge, type OrderRow } from './orders/OrdersTable';

/** Дашборд: «Заказы, требующие действий» с кнопкой следующего шага (ТЗ §7.2). */
export function ActionOrders() {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ items: OrderRow[] }>('/supplier/orders?status=action')
      .then((r) => setRows(r.items))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const act = async (r: OrderRow, action: string) => {
    setBusy(r.id);
    setError(null);
    try {
      await api(`/supplier/orders/${r.id}/${action}`, {});
      load();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2>Заказы, требующие действий</h2>
        <Link href="/supplier/orders" className={s.link}>
          Все заказы →
        </Link>
      </div>
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {rows && rows.length === 0 && <p className={s.muted}>Сейчас всё обработано.</p>}
      {rows && rows.length > 0 && (
        <div className={s.tableCard}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col" style={{ width: '12%' }}>Номер</th>
                <th scope="col">Состав</th>
                <th scope="col" style={{ width: '12%' }}>Сумма</th>
                <th scope="col" style={{ width: '17%' }}>Статус</th>
                <th scope="col" style={{ width: '17%' }} aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 6).map((r) => {
                const next = NEXT_ACTION[r.status];
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link href={`/supplier/orders/${r.id}`} className={s.strong} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {r.number}
                      </Link>
                    </td>
                    <td style={{ minWidth: 200 }}>{r.items.join(', ')}</td>
                    <td className={s.semi} style={{ whiteSpace: 'nowrap' }}>
                      {formatRub(r.goodsTotal)}
                    </td>
                    <td>
                      <StatusBadge status={r.status} overdue={r.overdue} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {next && (
                        <Button className={s.rowBtn} variant={r.status === 'packed' ? 'outline' : 'primary'} disabled={busy === r.id} onClick={() => act(r, next[0])}>
                          {next[1]}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
