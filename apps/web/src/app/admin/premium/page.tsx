'use client';

import { PREMIUM_CONTACTS, PREMIUM_LEAD_STATUSES, formatRub, type PremiumLeadStatus } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Chip } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Row = { id: string; name: string; phone: string; contact: keyof typeof PREMIUM_CONTACTS; status: PremiumLeadStatus; title: string; total: number; count: number; createdAt: string };
const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const FILTERS: (PremiumLeadStatus | 'all')[] = ['new', 'in_progress', 'done', 'cancelled', 'all'];

/** Заявки из премиум-капсулы: менеджер перезванивает и ведёт заявку по статусам */
export default function AdminPremiumPage() {
  const [status, setStatus] = useState<PremiumLeadStatus | 'all'>('new');
  const [data, setData] = useState<{ items: Row[]; counts: Partial<Record<PremiumLeadStatus, number>> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api<{ items: Row[]; counts: Partial<Record<PremiumLeadStatus, number>> }>(`/admin/premium${status === 'all' ? '' : `?status=${status}`}`)
      .then(setData)
      .catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, [status]);
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Заявки премиум</h1>
        </div>
      </div>
      <div className={s.chips}>
        {FILTERS.map((f) => (
          <Chip key={f} active={status === f} onClick={() => setStatus(f)}>
            {f === 'all' ? 'Все' : PREMIUM_LEAD_STATUSES[f]}
            {f !== 'all' && data?.counts[f] ? ` · ${data.counts[f]}` : ''}
          </Chip>
        ))}
      </div>
      <p className={s.muted} style={{ margin: '8px 0 16px' }}>
        Покупатель собрал премиум-капсулу и оставил контакты. Онлайн-оплаты нет: менеджер связывается удобным способом и подтверждает состав.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <section className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Связь</th>
              <th>Капсула</th>
              <th>Статус</th>
              <th>Создана</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className={s.link} href={`/admin/premium/${r.id}`}>
                    {r.name}
                  </Link>
                  <div className={s.muted}>{r.phone}</div>
                </td>
                <td>{PREMIUM_CONTACTS[r.contact]}</td>
                <td>
                  {r.title}
                  <div className={s.muted}>
                    {r.count} шт. · {formatRub(r.total)}
                  </div>
                </td>
                <td>{PREMIUM_LEAD_STATUSES[r.status]}</td>
                <td className={s.muted}>{date(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <p className={s.muted} style={{ padding: 24 }}>Заявок нет.</p>}
      </section>
    </>
  );
}
