'use client';

import { PREMIUM_CONTACTS, PREMIUM_LEAD_STATUSES, formatRub, type PremiumLeadStatus } from '@aesculap/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Chip } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import t from './thread.module.css';

type Row = { id: string; no: number; unread: number; telegramLinked: boolean; name: string; phone: string; contact: keyof typeof PREMIUM_CONTACTS; status: PremiumLeadStatus; title: string; total: number; count: number; createdAt: string };
const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const FILTERS: (PremiumLeadStatus | 'all')[] = ['new', 'in_progress', 'done', 'cancelled', 'all'];

/** Заявки из премиум-капсулы: менеджер перезванивает и ведёт заявку по статусам */
export default function AdminPremiumPage() {
  const [status, setStatus] = useState<PremiumLeadStatus | 'all'>('new');
  const [data, setData] = useState<{ items: Row[]; counts: Partial<Record<PremiumLeadStatus, number>>; unreadTotal: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api<{ items: Row[]; counts: Partial<Record<PremiumLeadStatus, number>>; unreadTotal: number }>(`/admin/premium${status === 'all' ? '' : `?status=${status}`}`)
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
        {data?.unreadTotal ? <b> Непрочитанных сообщений клиентов: {data.unreadTotal}.</b> : null}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <section className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">Клиент</th>
              <th scope="col">Связь</th>
              <th scope="col">Капсула</th>
              <th scope="col">Статус</th>
              <th scope="col">Создана</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className={s.muted}>{r.no}</td>
                <td>
                  <Link className={s.link} href={`/admin/premium/${r.id}`}>
                    {r.name}
                  </Link>
                  {r.unread > 0 && (
                    <span className={t.unread}>
                      {r.unread}
                      <span className="visually-hidden"> непрочитанных сообщений</span>
                    </span>
                  )}
                  <div className={s.muted}>{r.phone}</div>
                </td>
                <td>
                  {PREMIUM_CONTACTS[r.contact]}
                  {r.telegramLinked && r.contact !== 'telegram' && <div className={s.muted}>Telegram привязан</div>}
                </td>
                <td>
                  {r.title}
                  <div className={s.muted}>
                    {r.count} шт. · {formatRub(r.total)}
                  </div>
                </td>
                <td>
                  <span className={`${s.badge} ${s[`b_p_${r.status}`] ?? ''}`}>{PREMIUM_LEAD_STATUSES[r.status]}</span>
                </td>
                <td className={s.muted}>{date(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <p className={s.empty}>Заявок нет.</p>}
      </section>
    </>
  );
}
