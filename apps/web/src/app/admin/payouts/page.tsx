'use client';

import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { Registry } from './Registry';

type Row = {
  id: string; legalName: string; inn: string; payoutStatus: 'not_connected' | 'in_review' | 'active'; accountId: string | null;
  details: { legalName: string; inn: string; bik: string; account: string | null } | null; requestedAt: string | null;
};
const STATUS = { active: 'Активен', in_review: 'На проверке', not_connected: 'Не подключён' } as const;

/** Подключение выплат: после онбординга поставщика в ЮKassa админ вносит ID получателя (ТЗ §7.8, §8). */
export default function AdminPayoutsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ids, setIds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Row[]>('/admin/payouts').then(setRows).catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  useEffect(() => void load(), []);

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Выплаты поставщиков</h1>
        </div>
      </div>
      <p className={s.muted} style={{ marginBottom: 16 }}>
        Поставщик заполняет реквизиты в кабинете, проходит проверку в ЮKassa и получает ID получателя (account_id). Внесите его здесь — выплаты включатся, товары появятся на витрине.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Поставщик</th>
              <th scope="col">Реквизиты</th>
              <th scope="col">Статус</th>
              <th scope="col">ID получателя ЮKassa</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.legalName}</b>
                  <div className={s.muted}>ИНН {r.inn}</div>
                </td>
                <td className={s.muted}>
                  {r.details ? (
                    <>
                      {r.details.legalName}, ИНН {r.details.inn}
                      <br />
                      р/с {r.details.account} · БИК {r.details.bik}
                    </>
                  ) : (
                    'не заполнены'
                  )}
                </td>
                <td>
                  <span className={`${s.badge} ${s[`b_${r.payoutStatus}`]}`}>{STATUS[r.payoutStatus]}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className={s.input} placeholder={r.accountId ?? 'account_id'} value={ids[r.id] ?? ''} onChange={(e) => setIds({ ...ids, [r.id]: e.target.value })} aria-label={`ID получателя для ${r.legalName}`} />
                    <Button
                      variant="outline"
                      disabled={!ids[r.id]?.trim()}
                      onClick={async () => {
                        setError(null);
                        try {
                          await api(`/admin/payouts/${r.id}/activate`, { accountId: ids[r.id] });
                          setIds({ ...ids, [r.id]: '' });
                          await load();
                        } catch (e) {
                          setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Ошибка');
                        }
                      }}
                    >
                      Подключить
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Registry />
    </>
  );
}
