'use client';

import { formatRub, payoutDetailsSchema } from '@aesculap/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Data = {
  payoutStatus: 'not_connected' | 'in_review' | 'active';
  accountId: string | null;
  commissionBp: number;
  monthTransferred: number;
  details: { legalName: string; inn: string; account: string; bik: string; requestedAt: string | null } | null;
  items: { id: string; kind: 'sale' | 'refund'; number: string; shipmentId: string; amountGoods: number; commission: number; transferred: number; createdAt: string }[];
};
const STATUS = { active: 'Активен', in_review: 'На проверке', not_connected: 'Не подключён' } as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Выплаты поставщика (ТЗ §7.8): статус онбординга ЮKassa, перечисления по сплиту, отчёт агента, реквизиты. */
export function Payouts() {
  const [data, setData] = useState<Data | null>(null);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ legalName: '', inn: '', account: '', bik: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Data>(`/supplier/payouts?from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => setError(isApiError(e) ? e.message : 'Не удалось загрузить выплаты'));
  }, [from, to]);
  useEffect(load, [load]);

  const save = async () => {
    const r = payoutDetailsSchema.safeParse(form);
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    try {
      setData(await api<Data>('/supplier/payouts/details', r.data, 'PUT'));
      setEdit(false);
      load();
    } catch (e) {
      setErrors(isApiError(e) && e.errors ? e.errors : {});
      setError(isApiError(e) ? e.message : 'Нет связи с сервером');
    }
  };

  if (!data) return error ? <Alert tone="error">{error}</Alert> : null;
  const sum = (k: 'amountGoods' | 'commission' | 'transferred') => data.items.reduce((acc, p) => acc + p[k], 0);

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Деньги</div>
          <h1>Выплаты</h1>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data.payoutStatus !== 'active' && (
        <Alert tone="error">
          {data.payoutStatus === 'in_review'
            ? 'Реквизиты на проверке в ЮKassa. До подтверждения товары не показываются на витрине.'
            : 'Выплаты не подключены: заполните реквизиты получателя. Пока выплаты не подключены, товары не публикуются.'}
        </Alert>
      )}

      <div className={`${s.tiles} ${s.tiles3}`} style={{ marginTop: 16 }}>
        <div className={s.tile}>
          <div className={s.tileLabel}>Онбординг ЮKassa</div>
          <b style={{ fontSize: 24 }}>
            <span className={`${s.badge} ${s[`b_${data.payoutStatus}`]}`}>{STATUS[data.payoutStatus]}</span>
          </b>
          <div className={s.tileHint}>{data.accountId ? `ID получателя ${data.accountId}` : 'ID получателя появится после проверки'}</div>
        </div>
        <div className={s.tile}>
          <div className={s.tileLabel}>Комиссия платформы</div>
          <b>{data.commissionBp / 100}%</b>
          <div className={s.tileHint}>Удерживается при оплате; в акциях может быть ниже</div>
        </div>
        <div className={s.tile}>
          <div className={s.tileLabel}>Перечислено за месяц</div>
          <b>{formatRub(data.monthTransferred)}</b>
          <div className={s.tileHint}>За вычетом комиссии и возвратов</div>
        </div>
      </div>

      <section className={`${s.panel} ${s.scroll}`}>
        <div className={s.head} style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Перечисления (сплит по заказам)</h2>
          <div className={s.filters} style={{ margin: 0, alignItems: 'center' }}>
            <input type="date" className={s.input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С" />
            <span className={s.muted}>—</span>
            <input type="date" className={s.input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="По" />
          </div>
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Операция</th>
              <th>Сумма товаров</th>
              <th>Комиссия</th>
              <th>Вам перечислено</th>
              <th>Когда</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/supplier/orders/${p.shipmentId}`} className={s.link}>
                    № {p.number}
                  </Link>
                </td>
                <td>{p.kind === 'sale' ? 'Продажа' : <span className={s.neg}>Возврат</span>}</td>
                <td className={p.amountGoods < 0 ? s.neg : undefined}>{formatRub(p.amountGoods)}</td>
                <td className={s.muted}>
                  {p.commission > 0 ? '−' : '+'}
                  {formatRub(Math.abs(p.commission))}
                </td>
                <td className={p.transferred < 0 ? s.neg : undefined}>
                  <b>{formatRub(p.transferred)}</b>
                </td>
                <td className={s.muted}>{new Date(p.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
            {data.items.length > 0 && (
              <tr>
                <td colSpan={2}>
                  <b>Итого за период</b>
                </td>
                <td>{formatRub(sum('amountGoods'))}</td>
                <td className={s.muted}>−{formatRub(sum('commission'))}</td>
                <td>
                  <b>{formatRub(sum('transferred'))}</b>
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
        {data.items.length === 0 && <p className={s.muted}>За выбранный период перечислений нет.</p>}
        <div className={s.filters} style={{ marginTop: 16, marginBottom: 0, alignItems: 'center' }}>
          <span className={s.muted}>Отчёт агента за месяц:</span>
          <input type="month" className={s.input} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Месяц отчёта" />
          <a className={s.link} href={`/api/supplier/payouts/report?month=${month}`}>
            Скачать CSV
          </a>
        </div>
      </section>

      <section className={s.panel} style={{ marginTop: 16 }}>
        <div className={s.head} style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Реквизиты получателя</h2>
          <Button
            variant="outline"
            onClick={() => {
              setForm({ legalName: data.details?.legalName ?? '', inn: data.details?.inn ?? '', account: '', bik: data.details?.bik ?? '' });
              setErrors({});
              setEdit(true);
            }}
          >
            {data.details ? 'Редактировать' : 'Заполнить'}
          </Button>
        </div>
        {data.details ? (
          <div className={s.kv} style={{ maxWidth: 480 }}>
            <div>
              <span>Юрлицо</span>
              <b>{data.details.legalName}</b>
            </div>
            <div>
              <span>ИНН</span>
              <b>{data.details.inn}</b>
            </div>
            <div>
              <span>Расчётный счёт</span>
              <b>{data.details.account}</b>
            </div>
            <div>
              <span>БИК</span>
              <b>{data.details.bik}</b>
            </div>
          </div>
        ) : (
          <p className={s.muted}>Реквизиты ещё не указаны.</p>
        )}
      </section>

      {edit && (
        <Modal eyebrow="Выплаты" title="Реквизиты получателя" onClose={() => setEdit(false)}>
          <Alert tone="error">Изменение реквизитов — это повторная проверка в ЮKassa: до её окончания товары скрыты с витрины.</Alert>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <Field label="Юрлицо" value={form.legalName} error={errors.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
            <Field label="ИНН" value={form.inn} error={errors.inn} inputMode="numeric" onChange={(e) => setForm({ ...form, inn: e.target.value })} />
            <Field label="Расчётный счёт" value={form.account} error={errors.account} inputMode="numeric" placeholder="20 цифр" onChange={(e) => setForm({ ...form, account: e.target.value })} />
            <Field label="БИК" value={form.bik} error={errors.bik} inputMode="numeric" onChange={(e) => setForm({ ...form, bik: e.target.value })} />
            <Button onClick={save}>Отправить на проверку</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
