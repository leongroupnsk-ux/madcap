'use client';

import { useState } from 'react';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

export type Application = {
  id: string; company: string; inn: string; contactName: string; phone: string; email: string; assortment: string;
  status: 'new' | 'approved' | 'rejected'; rejectReason: string | null; createdAt: string;
};

export function Applications({ initial }: { initial: Application[] }) {
  const [apps, setApps] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const reload = async () => setApps(await api<Application[]>('/admin/applications'));
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Ошибка');
    }
  };
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Заявки поставщиков</h1>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Компания</th>
              <th>Контакт</th>
              <th>Ассортимент</th>
              <th>Дата</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>
                  <b>{a.company}</b>
                  <div className={s.muted}>ИНН {a.inn}</div>
                </td>
                <td>
                  {a.contactName}
                  <div className={s.muted}>
                    {a.phone} · {a.email}
                  </div>
                </td>
                <td className={s.muted} style={{ maxWidth: 260 }}>
                  {a.assortment}
                </td>
                <td className={s.muted}>{new Date(a.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>
                  <Badge status={a.status} />
                  {a.rejectReason && <div className={s.muted}>{a.rejectReason}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.status === 'new' && (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <Button onClick={() => run(() => api(`/admin/applications/${a.id}/approve`, {}))}>Одобрить</Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const reason = prompt('Причина отказа (уйдёт заявителю)');
                          if (reason) void run(() => api(`/admin/applications/${a.id}/reject`, { reason }));
                        }}
                      >
                        Отклонить
                      </Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!apps.length && (
              <tr>
                <td colSpan={6} className={s.muted} style={{ padding: 24 }}>
                  Заявок нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
