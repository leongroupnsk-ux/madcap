'use client';

import { SHIPMENT_STATUS_LABEL, formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Chip } from '@/components/ui';
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

export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  return <span className={`${s.badge} ${s[`b_s_${overdue ? 'overdue' : status}`] ?? ''}`}>{overdue ? 'Ждёт > 24 ч' : status === 'new' ? 'Новый · оплачен' : SHIPMENT_STATUS_LABEL[status]}</span>;
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
          <div className="eyebrow">Исполнение</div>
          <h1>Заказы{rows ? ` · ${rows.length}` : ''}</h1>
        </div>
      </div>
      <div className={s.chips}>
        {FILTERS.map(([v, l]) => (
          <Chip key={v} active={status === v} onClick={() => setParam('status', v)}>
            {l}
          </Chip>
        ))}
      </div>
      <div className={s.filters}>
        <input className={s.input} style={{ flex: '1 1 260px', maxWidth: 360 }} placeholder="Номер заказа или имя клиента" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Состав</th>
              <th>Сумма</th>
              <th>Доставка</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const next = NEXT_ACTION[r.status];
              return (
                <tr key={r.id} className={r.overdue ? s.rowWarn : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link href={`/supplier/orders/${r.id}`} className={s.link}>
                      № {r.number}
                    </Link>
                    <div className={s.muted}>{new Date(r.paidAt ?? r.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td style={{ minWidth: 200 }}>
                    {r.items.map((i) => (
                      <div key={i}>{i}</div>
                    ))}
                    <div className={s.muted}>{r.customer}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatRub(r.goodsTotal)}</td>
                  <td style={{ minWidth: 180 }}>
                    {r.deliveryType === 'pvz' ? 'ПВЗ' : 'Курьер'} · {r.address}
                    <div className={s.muted}>
                      {r.trackNo ? `Трек ${r.trackNo}` : r.eta ? `до ${new Date(r.eta).toLocaleDateString('ru-RU')}` : ''}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={r.status} overdue={r.overdue} />
                    {r.returnRequested && (
                      <div style={{ marginTop: 4 }}>
                        <span className={`${s.badge} ${s.b_requested}`}>Запрошен возврат</span>
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {next ? (
                      <Button variant={r.status === 'new' ? 'primary' : 'outline'} disabled={busy === r.id} onClick={() => act(r, next[0])}>
                        {next[1]}
                      </Button>
                    ) : (
                      <Link href={`/supplier/orders/${r.id}`} className={s.link}>
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
