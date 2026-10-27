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
  items: string[]; goodsTotal: number; deliveryType: 'pvz' | 'courier'; address: string; eta: string | null; customer: string; trackNo: string | null; hasWaybill?: boolean;
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: OrderRow[] }>(`/supplier/orders?status=${status}&q=${encodeURIComponent(params.get('q') ?? '')}`)
      .then((r) => setRows(r.items))
      .catch((e) => setError(isApiError(e) ? e.message : 'Не удалось загрузить заказы'));
  }, [status, params]);
  useEffect(load, [load]);
  // Выбор — только среди видимых строк с накладной
  const printable = (rows ?? []).filter((r) => r.hasWaybill);
  const selected = printable.filter((r) => picked.has(r.id));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Массовая печать: PDF приходит файлом, ошибки — JSON с сообщением */
  const print = async (path: 'waybills' | 'act', kind?: 'waybill' | 'barcode') => {
    const label = kind ?? path;
    setPrinting(label);
    setError(null);
    try {
      const res = await fetch(`/api/supplier/orders/print/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ids: selected.map((r) => r.id), ...(kind ? { kind } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.message === 'string' ? data.message : 'Не удалось сформировать PDF');
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'documents.pdf';
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нет связи с сервером');
    } finally {
      setPrinting(null);
    }
  };

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
      {/* Массовая печать: накладные/этикетки СДЭК одним PDF и акт приёма-передачи для курьера */}
      <div className={s.printBar} role="group" aria-label="Массовая печать">
        <label className={s.printAll}>
          <input
            type="checkbox"
            checked={printable.length > 0 && selected.length === printable.length}
            disabled={!printable.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(printable.map((r) => r.id)) : new Set())}
          />
          Выбрать все с накладной
        </label>
        <span className={s.printCount} aria-live="polite">
          {selected.length ? `Выбрано: ${selected.length}` : printable.length ? 'Отметьте отправления для печати' : 'Печать — для отправлений с накладной СДЭК'}
        </span>
        <span className={s.printActions}>
          <Button variant="outline" className={s.rowBtn} disabled={!selected.length || !!printing} onClick={() => void print('waybills', 'waybill')}>
            {printing === 'waybill' ? 'Готовим PDF…' : 'Печать накладных'}
          </Button>
          <Button variant="outline" className={s.rowBtn} disabled={!selected.length || !!printing} onClick={() => void print('waybills', 'barcode')}>
            {printing === 'barcode' ? 'Готовим PDF…' : 'Печать этикеток'}
          </Button>
          <Button variant="outline" className={s.rowBtn} disabled={!selected.length || !!printing} onClick={() => void print('act')}>
            {printing === 'act' ? 'Готовим PDF…' : 'Акт приёма-передачи'}
          </Button>
        </span>
      </div>
      <div className={s.tableCard}>
        <table className={`${s.table} ${s.ordersTable}`}>
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '29%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Выбор для печати</span>
              </th>
              <th scope="col">Номер</th>
              <th scope="col">Состав</th>
              <th scope="col">Сумма</th>
              <th scope="col">Доставка</th>
              <th scope="col">Статус</th>
              <th scope="col" aria-label="Действие" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const next = NEXT_ACTION[r.status];
              return (
                <tr key={r.id} className={r.overdue ? s.rowWarn : undefined}>
                  <td className={s.pick}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.id) && !!r.hasWaybill}
                      disabled={!r.hasWaybill}
                      onChange={() => toggle(r.id)}
                      aria-label={r.hasWaybill ? `Выбрать отправление ${r.number} для печати` : `Отправление ${r.number}: накладная СДЭК ещё не создана`}
                    />
                  </td>
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
