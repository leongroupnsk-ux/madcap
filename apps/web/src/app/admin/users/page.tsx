'use client';

import { useCallback, useEffect, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Row = {
  id: string; email: string; phone: string | null; role: string; createdAt: string; lastActiveAt: string; orders: number;
  blockedAt: string | null; blockReason: string | null; suppliers: string[];
};
const ROLE: Record<string, string> = { buyer: 'Покупатель', supplier_staff: 'Поставщик', admin: 'Админ' };

/** Пользователи (ТЗ §8): поиск, блокировка, выгрузка и удаление ПДн по запросу. */
export default function AdminUsersPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<{ id: string; email: string; reason: string } | null>(null);
  const [remove, setRemove] = useState<Row | null>(null);

  const load = useCallback(() => {
    api<Row[]>(`/admin/users?q=${encodeURIComponent(q)}`)
      .then(setRows)
      .catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Ошибка');
      return false;
    }
  };

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Пользователи</h1>
        </div>
      </div>
      <p className={s.muted} style={{ marginBottom: 12 }}>
        Запросы субъектов ПДн: выгрузка данных — JSON для ответа на запрос; удаление обезличивает аккаунт, заказы сохраняются для бухучёта. Все действия пишутся в журнал аудита.
      </p>
      <div className={s.filters}>
        <input className={s.input} style={{ flex: '1 1 260px', maxWidth: 360 }} placeholder="Email или телефон" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Пользователь</th>
              <th scope="col">Роль</th>
              <th scope="col">Заказов</th>
              <th scope="col">Активность</th>
              <th scope="col">Статус</th>
              <th scope="col" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.email}</b>
                  <div className={s.muted}>
                    {u.phone ?? ''}
                    {u.suppliers.length > 0 && ` · ${u.suppliers.join(', ')}`}
                  </div>
                </td>
                <td>{ROLE[u.role] ?? u.role}</td>
                <td>{u.orders}</td>
                <td className={s.muted}>{new Date(u.lastActiveAt).toLocaleDateString('ru-RU')}</td>
                <td>
                  {u.blockedAt ? (
                    <>
                      <span className={`${s.badge} ${s.b_rejected}`}>Заблокирован</span>
                      <div className={s.muted}>{u.blockReason}</div>
                    </>
                  ) : (
                    <span className={`${s.badge} ${s.b_active}`}>Активен</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div className={s.actions}>
                    <a className={s.link} href={`/api/admin/users/${u.id}/export`}>
                      Выгрузить
                    </a>
                    {u.blockedAt ? (
                      <Button variant="outline" onClick={() => run(() => api(`/admin/users/${u.id}/unblock`, {}))}>
                        Разблокировать
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => setBlock({ id: u.id, email: u.email, reason: '' })}>
                        Заблокировать
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setRemove(u)}>
                      Удалить
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className={s.empty}>Никого не нашли.</p>}
      </div>

      {block && (
        <Modal eyebrow={block.email} title="Заблокировать" onClose={() => setBlock(null)}>
          <Field label="Причина" value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} />
          <div style={{ marginTop: 12 }}>
            <Button disabled={block.reason.trim().length < 3} onClick={async () => (await run(() => api(`/admin/users/${block.id}/block`, { reason: block.reason }))) && setBlock(null)}>
              Заблокировать и завершить сессии
            </Button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal eyebrow={remove.email} title="Удалить по запросу?" onClose={() => setRemove(null)}>
          <p style={{ marginBottom: 12 }}>Анкета, фото, капсулы, адреса и корзина удалятся, учётная запись будет обезличена. Отменить нельзя.</p>
          <Button onClick={async () => (await run(() => api(`/admin/users/${remove.id}/delete`, {}))) && setRemove(null)}>Удалить</Button>
        </Modal>
      )}
    </>
  );
}
