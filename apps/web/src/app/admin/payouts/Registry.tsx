'use client';

import { formatRub } from '@aesculap/shared';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Overview = {
  mode: { mode: 'split' | 'registry'; reason: string | null; since: string | null };
  pending: {
    suppliers: { supplierId: string; legalName: string; inn: string; rows: number; amount: number; problem: string | null; details: { legalName: string; bik: string; account: string } | null }[];
    waiting: { rows: number; amount: number };
  };
  registries: { id: string; number: number; total: number; rows: number; createdAt: string; paidAt: string | null }[];
};
const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** Аварийный режим выплат и реестры ручных перечислений (ТЗ §8) */
export function Registry() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    api<Overview>('/admin/payouts/registry').then(setOv).catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
  }, []);
  if (!ov) return msg ? <Alert tone="error">{msg.text}</Alert> : null;

  const run = async (fn: () => Promise<Overview>, ok: string) => {
    setMsg(null);
    try {
      setOv(await fn());
      setMsg({ tone: 'success', text: ok });
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером' });
      return false;
    }
  };
  const emergency = ov.mode.mode === 'registry';
  const ready = ov.pending.suppliers.filter((x) => !x.problem);

  return (
    <>
      <h2 style={{ marginTop: 32 }}>Аварийный режим выплат</h2>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <section className={s.panel} style={{ marginTop: 12 }}>
        {emergency ? (
          <Alert tone="error">
            Включён с {ov.mode.since ? date(ov.mode.since) : '—'}: {ov.mode.reason}. Новые заказы оплачиваются без сплита, деньги поставщикам перечисляет платформа по реестру.
          </Alert>
        ) : (
          <p className={s.muted}>
            Сейчас деньги поставщикам переводит ЮKassa (сплит). Если сплит недоступен, включите аварийный режим: оплату примет платформа, поставщикам — реестром платёжных поручений.
          </p>
        )}
        <div className={s.filters} style={{ alignItems: 'flex-end', marginTop: 12 }}>
          <div style={{ flex: '1 1 320px' }}>
            <Field label="Причина (попадёт в журнал и оповещение)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            variant={emergency ? 'primary' : 'outline'}
            onClick={async () => {
              if (!emergency && !confirm('Включить аварийный режим? Новые заказы пойдут без сплита.')) return;
              if (await run(() => api<Overview>('/admin/payouts/registry/mode', { mode: emergency ? 'split' : 'registry', reason }, 'PUT'), emergency ? 'Сплит снова включён' : 'Аварийный режим включён')) setReason('');
            }}
          >
            {emergency ? 'Вернуть сплит' : 'Включить аварийный режим'}
          </Button>
        </div>
      </section>

      <section className={`${s.panel} ${s.scroll}`} style={{ marginTop: 16 }}>
        <h2>К выплате по реестру</h2>
        <p className={s.muted} style={{ marginBottom: 10 }}>
          Продажи попадают сюда после закрытия отправления (доставлено или отменено), возвраты — сразу.
          {ov.pending.waiting.rows > 0 && ` Ещё ждут доставки: ${ov.pending.waiting.rows} отправл. на ${formatRub(ov.pending.waiting.amount)}.`}
        </p>
        {ov.pending.suppliers.length === 0 ? (
          <p className={s.muted}>Нет строк к выплате.</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Поставщик</th>
                <th>Реквизиты</th>
                <th>Строк</th>
                <th>Сумма</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ov.pending.suppliers.map((x) => (
                <tr key={x.supplierId}>
                  <td>
                    <b>{x.legalName}</b>
                    <div className={s.muted}>ИНН {x.inn}</div>
                  </td>
                  <td className={s.muted}>{x.details ? `р/с ${x.details.account} · БИК ${x.details.bik}` : '—'}</td>
                  <td>{x.rows}</td>
                  <td>{formatRub(x.amount)}</td>
                  <td className={s.muted}>{x.problem ?? 'войдёт в реестр'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 12 }}>
          <Button disabled={!ready.length} onClick={() => run(() => api<Overview>('/admin/payouts/registry', {}), 'Реестр сформирован — скачайте CSV для банка')}>
            Сформировать реестр{ready.length ? ` · ${formatRub(ready.reduce((a, x) => a + x.amount, 0))}` : ''}
          </Button>
        </div>
      </section>

      {ov.registries.length > 0 && (
        <section className={`${s.panel} ${s.scroll}`} style={{ padding: 0, marginTop: 16 }}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Реестр</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ov.registries.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>№ {r.number}</b>
                    <div className={s.muted}>
                      {date(r.createdAt)} · строк: {r.rows}
                    </div>
                  </td>
                  <td>{formatRub(r.total)}</td>
                  <td>{r.paidAt ? `оплачен ${date(r.paidAt)}` : <span className={s.muted}>ждёт оплаты в банке</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a className={s.link} href={`/api/admin/payouts/registry/${r.id}/csv`}>
                        CSV для банка
                      </a>
                      {!r.paidAt && (
                        <>
                          <Button variant="outline" onClick={() => confirm(`Платёжки по реестру № ${r.number} проведены банком?`) && run(() => api<Overview>(`/admin/payouts/registry/${r.id}/paid`, {}), `Реестр № ${r.number} отмечен оплаченным`)}>
                            Оплачен
                          </Button>
                          <Button variant="ghost" onClick={() => confirm(`Отменить реестр № ${r.number}? Строки вернутся в очередь.`) && run(() => api<Overview>(`/admin/payouts/registry/${r.id}/cancel`, {}), 'Реестр отменён')}>
                            Отменить
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
