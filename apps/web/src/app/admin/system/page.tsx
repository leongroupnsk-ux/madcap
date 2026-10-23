'use client';

import { STAFF_AREAS, STAFF_ROLES, platformSettingsSchema, type PlatformSettings, type StaffRoleId } from '@aesculap/shared';
import { useCallback, useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Chip, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Staff = { id: string; email: string; staffRole: StaffRoleId; activated: boolean; lastActiveAt: string; blocked: boolean; twoFactor: boolean };
type Log = { id: string; at: string; actor: string; action: string; entity: string; entityId: string | null; data: unknown };
type Tab = 'staff' | 'audit' | 'settings';

const roleAreas = (r: StaffRoleId) =>
  r === 'owner'
    ? 'все разделы'
    : Object.values(STAFF_AREAS)
        .filter((a) => (a.roles as readonly string[]).includes(r))
        .map((a) => a.label.toLowerCase())
        .join(', ');

/** Сотрудники, журнал действий и настройки платформы (ТЗ §8) — раздел владельца. */
export default function AdminSystemPage() {
  const [tab, setTab] = useState<Tab>('staff');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [invite, setInvite] = useState<{ email: string; staffRole: StaffRoleId }>({ email: '', staffRole: 'support' });
  const [log, setLog] = useState<Log[]>([]);
  const [filter, setFilter] = useState({ action: '', actor: '' });
  const [settings, setSettings] = useState<Record<keyof PlatformSettings, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const run = async <T,>(fn: () => Promise<T>, ok?: string) => {
    setMsg(null);
    setErrors({});
    try {
      const r = await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      return r;
    } catch (e) {
      if (isApiError(e)) {
        setErrors(e.errors ?? {});
        setMsg({ tone: 'error', text: e.message });
      } else setMsg({ tone: 'error', text: 'Нет связи с сервером' });
      return null;
    }
  };

  useEffect(() => {
    void api<Staff[]>('/admin/system/staff').then(setStaff);
    void api<PlatformSettings>('/admin/system/settings').then((v) => setSettings({ defaultCommissionPct: String(v.defaultCommissionPct), confirmHours: String(v.confirmHours), payMinutes: String(v.payMinutes) }));
  }, []);
  const loadLog = useCallback(() => {
    void api<Log[]>(`/admin/system/audit?action=${encodeURIComponent(filter.action)}&actor=${encodeURIComponent(filter.actor)}`).then(setLog);
  }, [filter]);
  useEffect(() => {
    if (tab !== 'audit') return;
    const t = setTimeout(loadLog, 300);
    return () => clearTimeout(t);
  }, [tab, loadLog]);

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Сотрудники и настройки</h1>
        </div>
      </div>
      <div className={s.chips}>
        {(
          [
            ['staff', 'Сотрудники'],
            ['audit', 'Журнал действий'],
            ['settings', 'Настройки платформы'],
          ] as const
        ).map(([id, l]) => (
          <Chip key={id} active={tab === id} onClick={() => setTab(id)}>
            {l}
          </Chip>
        ))}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {tab === 'staff' && (
        <>
          <section className={s.panel} style={{ marginTop: 12 }}>
            <h2>Пригласить</h2>
            <div className={s.filters} style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 240px' }}>
                <Field label="Рабочий email" value={invite.email} error={errors.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              </div>
              <select className={s.input} value={invite.staffRole} onChange={(e) => setInvite({ ...invite, staffRole: e.target.value as StaffRoleId })} aria-label="Роль">
                {Object.entries(STAFF_ROLES).map(([id, l]) => (
                  <option key={id} value={id}>
                    {l}
                  </option>
                ))}
              </select>
              <Button
                onClick={async () => {
                  const r = await run(() => api<Staff[]>('/admin/system/staff', invite), `Приглашение отправлено на ${invite.email}`);
                  if (r) {
                    setStaff(r);
                    setInvite({ ...invite, email: '' });
                  }
                }}
              >
                Пригласить
              </Button>
            </div>
            <p className={s.muted}>Доступ роли «{STAFF_ROLES[invite.staffRole]}»: {roleAreas(invite.staffRole)}.</p>
          </section>
          <section className={`${s.panel} ${s.scroll}`} style={{ padding: 0, marginTop: 16 }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>Последняя активность</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.email}</b>
                      <div className={s.muted}>
                        {u.activated ? 'пароль задан' : 'приглашение не принято'}
                        {u.twoFactor && ' · 2FA'}
                        {u.blocked && ' · заблокирован'}
                      </div>
                    </td>
                    <td>
                      <select
                        className={s.input}
                        value={u.staffRole}
                        onChange={async (e) => {
                          const r = await run(() => api<Staff[]>(`/admin/system/staff/${u.id}`, { staffRole: e.target.value }, 'PUT'), 'Роль изменена');
                          if (r) setStaff(r);
                        }}
                        aria-label={`Роль ${u.email}`}
                      >
                        {Object.entries(STAFF_ROLES).map(([id, l]) => (
                          <option key={id} value={id}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <div className={s.muted} style={{ marginTop: 4 }}>
                        {roleAreas(u.staffRole)}
                      </div>
                    </td>
                    <td className={s.muted}>{new Date(u.lastActiveAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(`Отозвать доступ ${u.email}?`)) return;
                          const r = await run(() => api<Staff[]>(`/admin/system/staff/${u.id}/revoke`, {}), 'Доступ отозван');
                          if (r) setStaff(r);
                        }}
                      >
                        Отозвать доступ
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'audit' && (
        <>
          <div className={s.filters} style={{ marginTop: 12 }}>
            <input className={s.input} placeholder="Действие: order., staff., moderation." value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value })} aria-label="Действие" />
            <input className={s.input} placeholder="Email сотрудника" value={filter.actor} onChange={(e) => setFilter({ ...filter, actor: e.target.value })} aria-label="Сотрудник" />
          </div>
          <section className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кто</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>Данные</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td className={s.muted} style={{ whiteSpace: 'nowrap' }}>
                      {new Date(r.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })}
                    </td>
                    <td>{r.actor}</td>
                    <td>
                      <code>{r.action}</code>
                    </td>
                    <td className={s.muted}>
                      {r.entity}
                      {r.entityId && <div style={{ fontSize: 11 }}>{r.entityId.slice(0, 8)}…</div>}
                    </td>
                    <td className={s.muted} style={{ maxWidth: 360, wordBreak: 'break-word', fontSize: 12 }}>
                      {r.data ? JSON.stringify(r.data).slice(0, 240) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {log.length === 0 && <p className={s.muted} style={{ padding: 24 }}>Записей не найдено.</p>}
          </section>
        </>
      )}

      {tab === 'settings' && settings && (
        <section className={s.panel} style={{ marginTop: 12, maxWidth: 560 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Комиссия для новых поставщиков, %" type="number" step="0.5" value={settings.defaultCommissionPct} error={errors.defaultCommissionPct} onChange={(e) => setSettings({ ...settings, defaultCommissionPct: e.target.value })} hint="Применяется при одобрении заявки; у действующих поставщиков не меняется" />
            <Field label="Срок подтверждения заказа поставщиком, ч" type="number" value={settings.confirmHours} error={errors.confirmHours} onChange={(e) => setSettings({ ...settings, confirmHours: e.target.value })} hint="После — отмена отправления с возвратом денег; напоминание приходит через 24 ч" />
            <Field label="Срок оплаты заказа и резерв товара, мин" type="number" value={settings.payMinutes} error={errors.payMinutes} onChange={(e) => setSettings({ ...settings, payMinutes: e.target.value })} />
            <Button
              onClick={async () => {
                const parsed = platformSettingsSchema.safeParse(settings);
                if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
                await run(() => api('/admin/system/settings', parsed.data, 'PUT'), 'Настройки сохранены');
              }}
            >
              Сохранить
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
