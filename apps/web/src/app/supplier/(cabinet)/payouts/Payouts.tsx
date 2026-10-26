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
  items: {
    id: string; kind: 'sale' | 'refund'; number: string; shipmentId: string; amountGoods: number; commission: number; transferred: number; createdAt: string;
    method?: 'split' | 'registry' | 'registry_pending'; registryNumber?: number | null;
  }[];
};
const STATUS = { active: 'Активен', in_review: 'На проверке', not_connected: 'Не подключён' } as const;
const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
type RunningPromo = { name: string; commissionBp: number; phase: string };

/** «сегодня 12:04», «вчера 18:22», «25 авг 09:10» — как в макете */
function when(d: string) {
  const at = new Date(d);
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `сегодня ${time}`;
  if (days === 1) return `вчера ${time}`;
  return `${at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')} ${time}`;
}
/** Счёт приходит из API уже замаскированным */
const account = (a: string) => a;
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
  const [promo, setPromo] = useState<RunningPromo | null>(null);
  useEffect(() => {
    api<RunningPromo[]>('/supplier/promotions')
      .then((list) => setPromo(list.find((p) => p.phase === 'running') ?? null))
      .catch(() => undefined);
  }, []);

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

  const manual = data.items.some((p) => p.method && p.method !== 'split');
  const now = new Date();
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Кабинет поставщика</div>
          <h1>Выплаты</h1>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data.payoutStatus !== 'active' && (
        <div className={s.notice}>
          {data.payoutStatus === 'in_review'
            ? 'Реквизиты на проверке в ЮKassa. До подтверждения товары не показываются на витрине.'
            : 'Выплаты не подключены: заполните реквизиты получателя. Пока выплаты не подключены, товары не публикуются.'}
        </div>
      )}

      {/* Кадр .Partner-Cash: три карточки, таблица перечислений, реквизиты */}
      <div className={s.cashCards}>
        <div className={s.cashCard}>
          <span className={s.cashLabel}>Статус онбординга ЮKassa</span>
          <span className={`${s.cashBadge} ${s[`cash_${data.payoutStatus}`]}`}>{STATUS[data.payoutStatus]}</span>
          <span className={s.cashHint}>{data.accountId ? `ID получателя: ${data.accountId}` : 'ID получателя появится после проверки'}</span>
        </div>
        <div className={s.cashCard}>
          <span className={s.cashLabel}>Комиссия платформы</span>
          <b className={s.cashValue}>{data.commissionBp / 100}%</b>
          <span className={s.cashHint}>{promo && promo.commissionBp < data.commissionBp ? `на время «${promo.name}» — ${promo.commissionBp / 100}%` : 'удерживается при оплате; в акциях может быть ниже'}</span>
        </div>
        <div className={s.cashCard}>
          <span className={s.cashLabel}>Перечислено за {MONTH[now.getMonth()]}</span>
          <b className={s.cashValue}>{formatRub(data.monthTransferred)}</b>
          <span className={`${s.cashHint} ${s.cashHintStrong}`}>{manual ? 'часть выплат — реестром платформы' : 'сплит в момент оплаты, без реестров'}</span>
        </div>
      </div>

      <section className={s.cashTable}>
        <div className={s.cashTableHead}>
          <h2>Последние перечисления (сплит по заказам)</h2>
          <div className={s.cashRange}>
            <input type="date" className={s.input} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С" />
            <span className={s.muted}>—</span>
            <input type="date" className={s.input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="По" />
          </div>
        </div>
        <div className={s.scroll}>
          <table className={`${s.table} ${s.cashGrid}`}>
            <thead>
              <tr>
                <th scope="col">Заказ</th>
                <th scope="col">Сумма товаров</th>
                <th scope="col">Комиссия</th>
                <th scope="col">Вам перечислено</th>
                <th scope="col">Когда</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => {
                const pct = p.amountGoods ? Math.round((Math.abs(p.commission) / Math.abs(p.amountGoods)) * 1000) / 10 : 0;
                return (
                  <tr key={p.id}>
                    <td data-label="Заказ">
                      <Link href={`/supplier/orders/${p.shipmentId}`} className={s.orderNo}>
                        {p.number}
                      </Link>
                      {p.kind === 'refund' && <span className={s.neg}> · возврат</span>}
                    </td>
                    <td data-label="Сумма товаров" className={p.amountGoods < 0 ? s.neg : undefined}>
                      {formatRub(p.amountGoods)}
                    </td>
                    <td data-label="Комиссия" className={s.cashMuted}>
                      {p.commission > 0 ? '−' : '+'}
                      {formatRub(Math.abs(p.commission))} ({pct.toLocaleString('ru-RU')}%{pct * 100 < data.commissionBp ? ', акция' : ''})
                    </td>
                    <td data-label="Вам перечислено" className={`${s.cashStrong} ${p.transferred < 0 ? s.neg : ''}`}>
                      {formatRub(p.transferred)}
                    </td>
                    <td data-label="Когда" className={s.cashFaint}>
                      {when(p.createdAt)}
                      {p.method === 'registry' && <div className={s.sub}>реестр № {p.registryNumber}</div>}
                      {p.method === 'registry_pending' && <div className={s.sub}>ожидает реестра</div>}
                    </td>
                  </tr>
                );
              })}
              {data.items.length > 0 && (
                <tr className={s.cashTotal}>
                  <td data-label="">Итого за период</td>
                  <td data-label="Сумма товаров">{formatRub(sum('amountGoods'))}</td>
                  <td data-label="Комиссия" className={s.cashMuted}>
                    −{formatRub(sum('commission'))}
                  </td>
                  <td data-label="Вам перечислено" className={s.cashStrong}>
                    {formatRub(sum('transferred'))}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data.items.length === 0 && <p className={`${s.muted} ${s.cashEmpty}`}>За выбранный период перечислений нет.</p>}
        <div className={s.cashReport}>
          <span className={s.muted}>Отчёт агента за месяц:</span>
          <input type="month" className={s.input} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Месяц отчёта" />
          <a className={s.link} href={`/api/supplier/payouts/report?month=${month}`}>
            Скачать CSV
          </a>
          <span className={s.cashHint}>в отчёте — способ перечисления по каждой строке (сплит ЮKassa или реестр)</span>
        </div>
      </section>

      <section className={s.cashCard} style={{ marginTop: 24 }}>
        <span className={s.cashTitle}>Реквизиты получателя</span>
        <span className={s.cashLabel}>
          {data.details
            ? `${data.details.legalName} · ИНН ${data.details.inn} · р/с ${account(data.details.account)} · БИК ${data.details.bik}`
            : 'Реквизиты ещё не указаны.'}
        </span>
        <button
          type="button"
          className={s.textBtn}
          style={{ justifySelf: 'start' }}
          onClick={() => {
            setForm({ legalName: data.details?.legalName ?? '', inn: data.details?.inn ?? '', account: '', bik: data.details?.bik ?? '' });
            setErrors({});
            setEdit(true);
          }}
        >
          {data.details ? 'Редактировать →' : 'Заполнить →'}
        </button>
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
