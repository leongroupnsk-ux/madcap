'use client';

import { SHIPMENT_STATUS_LABEL, formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

export type OrderRow = {
  id: string; number: string; createdAt: string; paidAt: string | null; status: string; overdue: boolean; returnRequested: boolean;
  items: string[]; goodsTotal: number; deliveryType: 'pvz' | 'courier'; address: string; eta: string | null; customer: string; trackNo: string | null;
};

const FILTERS = [
  ['action', 'Требуют действий'], ['new', 'Новые'], ['confirmed', 'Подтверждены'], ['packed', 'Упакованы'], ['handed_over', 'Переданы в СДЭК'],
  ['in_transit', 'В пути'], ['delivered', 'Доставлены'], ['returns', 'Возвраты'], ['cancelled', 'Отменены'], ['all', 'Все'],
] as const;
export const NEXT_ACTION: Record<string, [string, string]> = { new: ['confirm', 'Подтвердить'], confirmed: ['pack', 'Упаковано'], packed: ['waybill', 'Накладная СДЭК'] };

// Короткие подписи статусов, как в макете (полные — в SHIPMENT_STATUS_LABEL)
const SHORT_LABEL: Record<string, string> = { new: 'Новый · оплачен', confirmed: 'Подтверждён', rejected: 'Отклонён' };

export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  return <span className={`${s.badge} ${s[`b_s_${overdue ? 'overdue' : status}`] ?? ''}`}>{overdue ? 'Ждёт > 24 ч' : (SHORT_LABEL[status] ?? SHIPMENT_STATUS_LABEL[status])}</span>;
}

/** Отправления поставщика (ТЗ §7.5): поиск, фильтр статуса, следующее действие в строке. */
export function OrdersTable() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const status = params.get('status') ?? 'action';
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: OrderRow[] }>(`/supplier/orders?status=${status}&q=${encodeURIComponent(params.get('q') ?? '')}`)
      .then((r) => setRows(r.items))
      .catch((e) => setError(isApiError(e) ? e.message : 'Не удалось загрузить заказы'));
  }, [status, params]);
  useEffect(load, [load]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${path}?${next}`);
  };
  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get('q') ?? '') ? setParam('q', q) : undefined), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const act = async (row: OrderRow, action: string) => {
    setBusy(row.id);
    setError(null);
    try {
      await api(`/supplier/orders/${row.id}/${action}`, {});
      load();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Обработка заказов</div>
          <h1>Заказы</h1>
        </div>
      </div>
      {/* Поиск и фильтр статуса (кадр .Partner-Orders): вместо ряда чипов — выпадающий список */}
      <div className={s.filters}>
        <input className={`${s.input} ${s.search}`} placeholder="Поиск по номеру или клиенту" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по номеру или клиенту" />
        <select className={s.input} value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Статус заказов">
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className={s.tableCard}>
        <table className={`${s.table} ${s.ordersTable}`}>
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '33%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Состав</th>
              <th>Сумма</th>
              <th>Доставка</th>
              <th>Статус</th>
              <th aria-label="Действие" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const next = NEXT_ACTION[r.status];
              return (
                <tr key={r.id} className={r.overdue ? s.rowWarn : undefined}>
                  <td data-label="Номер">
                    <Link href={`/supplier/orders/${r.id}`} className={s.orderNo}>
                      {r.number}
                    </Link>
                  </td>
                  <td data-label="Состав">
                    {r.items.join(', ')}
                    <div className={s.sub}>{r.customer}</div>
                  </td>
                  <td data-label="Сумма" className={s.nowrap}>
                    {formatRub(r.goodsTotal)}
                  </td>
                  <td data-label="Доставка">
                    {r.deliveryType === 'pvz' ? 'ПВЗ СДЭК' : 'Курьер'} · {r.address}
                    <div className={s.sub}>{r.eta ? new Date(r.eta).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : `оплачен ${new Date(r.paidAt ?? r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`}</div>
                  </td>
                  <td data-label="Статус">
                    <StatusBadge status={r.status} overdue={r.overdue} />
                    {r.returnRequested && (
                      <div style={{ marginTop: 4 }}>
                        <span className={`${s.badge} ${s.b_requested}`}>Запрошен возврат</span>
                      </div>
                    )}
                  </td>
                  <td className={s.rowAction}>
                    {next ? (
                      <Button className={`${s.rowBtn} ${s.rowBtnWide}`} variant={r.status === 'new' ? 'primary' : 'outline'} disabled={busy === r.id} onClick={() => act(r, next[0])}>
                        {next[1]}
                      </Button>
                    ) : r.trackNo ? (
                      <Link href={`/supplier/orders/${r.id}`} className={s.track} title={`Трек ${r.trackNo}`}>
                        трек {r.trackNo.length > 4 ? `${r.trackNo.slice(0, 4)}…` : r.trackNo}
                      </Link>
                    ) : (
                      <Link href={`/supplier/orders/${r.id}`} className={s.track}>
                        Открыть
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows?.length === 0 && (
          <p className={s.muted} style={{ padding: 24 }}>
            {status === 'action' ? 'Сейчас нет заказов, которые ждут действий.' : 'Заказов с таким статусом нет.'}
          </p>
        )}
      </div>
    </>
  );
}
