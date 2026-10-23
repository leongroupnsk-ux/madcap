'use client';

import { MEMBER_ROLE_LABEL, supplierSettingsSchema } from '@aesculap/shared';
import { useState } from 'react';
import { useForm } from '@/components/auth/useForm';
import { NotificationSettings } from './NotificationSettings';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { SupplierMe } from '@/lib/types';

type Member = { userId: string; email: string; role: 'owner' | 'catalog' | 'warehouse'; activated: boolean };

export function Settings({ me, initialMembers }: { me: SupplierMe; initialMembers: Member[] }) {
  const owner = me.role === 'owner';
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Настройки</div>
          <h1>Настройки</h1>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
        {owner && <ProfileForm me={me} />}
        {owner && <Members initial={initialMembers} />}
        <Security enabled={me.user.totpEnabled} email={me.user.email} />
        <NotificationSettings />
      </div>
    </>
  );
}

function ProfileForm({ me }: { me: SupplierMe }) {
  const [saved, setSaved] = useState(false);
  const { errors, formError, pending, submit } = useForm(supplierSettingsSchema, async (data) => {
    await api('/supplier/settings', data, 'PUT');
    setSaved(true);
  });
  const sup = me.supplier;
  return (
    <section className={s.panel}>
      <h2>Профиль и склад</h2>
      <form
        noValidate
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void submit(Object.fromEntries(new FormData(e.currentTarget)));
        }}
      >
        <div className={s.muted}>
          {sup.legalName} · ИНН {sup.inn} · комиссия {(sup.commissionBp / 100).toLocaleString('ru-RU')}%
        </div>
        {formError && <Alert tone="error">{formError}</Alert>}
        {saved && <Alert tone="success">Сохранено</Alert>}
        <Field label="О компании" name="description" defaultValue={sup.description} placeholder="Производитель медодежды" error={errors.description} />
        <Field label="Адрес склада отгрузки" name="warehouseAddress" defaultValue={sup.warehouseAddress} placeholder="Москва, Складочная 1с5" error={errors.warehouseAddress} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Код города СДЭК" name="cdekCityCode" inputMode="numeric" defaultValue={sup.cdekCityCode ?? ''} placeholder="44 — Москва" error={errors.cdekCityCode} hint="От него считаются тарифы" />
          <Field label="Отгрузка, дней" name="shipDays" type="number" min={0} max={14} defaultValue={sup.shipDays} error={errors.shipDays} />
          <Field
            label="Пункт сдачи СДЭК"
            name="cdekShipmentPoint"
            defaultValue={sup.cdekShipmentPoint ?? ''}
            placeholder="MSK65"
            error={errors.cdekShipmentPoint}
            hint="Код пункта СДЭК, куда вы сдаёте посылки — нужен для накладных"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </form>
    </section>
  );
}

function Members({ initial }: { initial: Member[] }) {
  const [members, setMembers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'catalog' | 'warehouse'>('catalog');
  return (
    <section className={s.panel}>
      <h2>Сотрудники</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <table className={s.table}>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>
                {m.email}
                {!m.activated && <div className={s.muted}>приглашение отправлено</div>}
              </td>
              <td className={s.muted}>{MEMBER_ROLE_LABEL[m.role]}</td>
              <td style={{ textAlign: 'right' }}>
                {m.role !== 'owner' && (
                  <button
                    className={s.link}
                    style={{ border: 0, background: 'none', cursor: 'pointer' }}
                    onClick={async () => {
                      if (!confirm(`Закрыть доступ для ${m.email}?`)) return;
                      setMembers(await api<Member[]>(`/supplier/members/${m.userId}`, undefined, 'DELETE'));
                    }}
                  >
                    Удалить
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            setMembers(await api<Member[]>('/supplier/members', { email, role }));
            setEmail('');
          } catch (err) {
            setError(isApiError(err) ? (err.errors ? Object.values(err.errors)[0] : err.message) : 'Ошибка');
          }
        }}
      >
        <input className={s.input} style={{ flex: '1 1 200px' }} type="email" required placeholder="email сотрудника" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email сотрудника" />
        <select className={s.input} value={role} onChange={(e) => setRole(e.target.value as 'catalog' | 'warehouse')} aria-label="Роль">
          <option value="catalog">Каталог</option>
          <option value="warehouse">Склад</option>
        </select>
        <Button type="submit" variant="outline">
          Пригласить
        </Button>
      </form>
      <p className={s.muted} style={{ marginTop: 8 }}>
        «Каталог» — товары и импорт. «Склад» — заказы и отгрузки (этап 4).
      </p>
    </section>
  );
}

function Security({ enabled: initial, email }: { enabled: boolean; email: string }) {
  const [enabled, setEnabled] = useState(initial);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Ошибка');
    }
  };
  return (
    <section className={s.panel}>
      <h2>Безопасность</h2>
      <p className={s.muted}>
        {email} · двухфакторная защита {enabled ? 'включена' : 'выключена'}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {!enabled && !setup && (
        <Button variant="outline" onClick={() => run(async () => setSetup(await api('/auth/totp/setup', {})))}>
          Включить вход по коду
        </Button>
      )}
      {setup && !enabled && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            Добавьте ключ в Google Authenticator, Яндекс Ключ или 1Password и введите 6 цифр из приложения.
          </p>
          <code style={{ background: 'var(--c-bg)', padding: 10, borderRadius: 8, wordBreak: 'break-all' }}>{setup.secret}</code>
          <a className={s.link} href={setup.otpauthUrl}>
            Открыть в приложении на этом устройстве
          </a>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className={s.input} inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код" />
            <Button
              onClick={() =>
                run(async () => {
                  await api('/auth/totp/enable', { code });
                  setEnabled(true);
                  setSetup(null);
                  setCode('');
                })
              }
            >
              Подтвердить
            </Button>
          </div>
        </div>
      )}
      {enabled && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className={s.input} inputMode="numeric" placeholder="код для отключения" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код" />
          <Button
            variant="outline"
            onClick={() =>
              run(async () => {
                await api('/auth/totp/disable', { code });
                setEnabled(false);
                setCode('');
              })
            }
          >
            Отключить
          </Button>
        </div>
      )}
    </section>
  );
}
