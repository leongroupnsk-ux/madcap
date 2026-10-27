'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Chip } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Row = { id: string; name: string; question: string; sharePhotos: boolean; createdAt: string; answeredAt: string | null };
const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** Очередь вопросов покупателей стилисту (ТЗ §8) */
export default function AdminStylistPage() {
  const [status, setStatus] = useState<'open' | 'answered'>('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    api<Row[]>(`/admin/stylist?status=${status}`).then(setRows).catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, [status]);
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Консультации стилиста</h1>
        </div>
      </div>
      <div className={s.chips}>
        <Chip active={status === 'open'} onClick={() => setStatus('open')}>
          Ждут ответа
        </Chip>
        <Chip active={status === 'answered'} onClick={() => setStatus('answered')}>
          Отвечены
        </Chip>
      </div>
      <p className={s.muted} style={{ margin: '8px 0 16px' }}>
        Анкета и фото покупателя открыты, только пока вопрос ждёт ответа. Каждый просмотр записывается в журнал действий.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <section className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Покупатель</th>
              <th scope="col">Вопрос</th>
              <th scope="col">{status === 'open' ? 'Отправлен' : 'Ответ'}</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className={s.link} href={`/admin/stylist/${r.id}`}>
                    {r.name}
                  </Link>
                  {r.sharePhotos && <div className={s.muted}>с фото</div>}
                </td>
                <td style={{ maxWidth: 480 }}>{r.question}</td>
                <td className={s.muted}>{date(r.answeredAt ?? r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && <p className={s.empty}>Вопросов нет.</p>}
      </section>
    </>
  );
}
