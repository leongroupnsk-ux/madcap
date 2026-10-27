'use client';

import { MEMBER_ROLE_LABEL, supplierSettingsSchema } from '@aesculap/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from '@/components/auth/useForm';
import { ApiKeys } from './ApiKeys';
import { NotificationSettings } from './NotificationSettings';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { SupplierMe } from '@/lib/types';

type Member = { userId: string; email: string; role: 'owner' | 'catalog' | 'warehouse'; activated: boolean };

/** Настройки поставщика (кадр .Partner-Set): слева уведомления и каналы, справа профиль/склад, импорт, сотрудники, безопасность. */
export function Settings({ me, initialMembers }: { me: SupplierMe; initialMembers: Member[] }) {
  const owner = me.role === 'owner';
  const sup = me.supplier;
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Настройки</div>
          {/* ТЗ §12 п.11: заголовок раздела — «Настройки» (в макете «Настройки уведомлений») */}
          <h1>Настройки</h1>
          <p className={s.lead}>Выберите события и каналы, по которым хотите получать уведомления, и проверьте данные склада.</p>
        </div>
      </div>
      <div className={s.setGrid}>
        <NotificationSettings email={me.user.email} />
        <div className={s.setSide}>
          {owner && <ProfileForm me={me} />}
          {me.role !== 'warehouse' && (
            <section className={s.setCard}>
              <h3 className={s.setCardTitle}>Импорт</h3>
              <div className={s.staticField}>{sup.ymlFeedUrl ? `YML-фид: ${sup.ymlFeedUrl}` : 'YML-фид не подключён'}</div>
              <p className={s.setNote}>
                {sup.ymlFeedUrl ? 'Автосинк по расписанию (1, 6 или 24 ч) · частота и пауза' : 'Подключается'} в разделе{' '}
                <Link href="/supplier/import" className={s.link}>
                  «Импорт»
                </Link>
                .
              </p>
            </section>
          )}
          {owner && <ApiKeys />}
          {owner && <Members initial={initialMembers} />}
          <Security enabled={me.user.totpEnabled} email={me.user.email} />
        </div>
      </div>
    </>
  );
}

function ProfileForm({ me }: { me: SupplierMe }) {
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState(me.supplier);
  const { errors, formError, pending, submit } = useForm(supplierSettingsSchema, async (data) => {
    await api('/supplier/settings', data, 'PUT');
    setView((v) => ({ ...v, ...data, cdekCityCode: data.cdekCityCode ?? null }));
    setSaved(true);
    setEditing(false);
  });
  const sup = view;
  return (
    <section className={s.setCard}>
      <div className={s.setCardHead}>
        <h3 className={s.setCardTitle}>Профиль и склад</h3>
        {!editing && (
          <button type="button" className={s.textBtn} onClick={() => (setEditing(true), setSaved(false))}>
            Редактировать
          </button>
        )}
      </div>
      {saved && <Alert tone="success">Сохранено</Alert>}
      {!editing ? (
        <>
          <div className={s.staticGroup}>
            <div className={s.staticField}>
              {sup.legalName}
              {sup.description ? ` · ${sup.description}` : ''}
            </div>
            <div className={s.staticField}>
              Склад отгрузки: {sup.warehouseAddress || 'не указан'}
              {sup.cdekCityCode ? ` (код города СДЭК: ${sup.cdekCityCode})` : ''}
            </div>
            <div className={s.staticField}>
              ИНН {sup.inn} · комиссия {(sup.commissionBp / 100).toLocaleString('ru-RU')}% · отгрузка {sup.shipDays} дн.
              {sup.cdekShipmentPoint ? ` · пункт сдачи ${sup.cdekShipmentPoint}` : ''}
            </div>
          </div>
          <p className={s.setNote}>Код города обязателен — от него считаются тарифы СДЭК.</p>
        </>
      ) : (
        <form
          noValidate
          className={s.setForm}
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void submit(Object.fromEntries(new FormData(e.currentTarget)));
          }}
        >
          {formError && <Alert tone="error">{formError}</Alert>}
          <Field label="О компании" name="description" defaultValue={sup.description} placeholder="Производитель медодежды" error={errors.description} />
          <Field label="Адрес склада отгрузки" name="warehouseAddress" defaultValue={sup.warehouseAddress} placeholder="Москва, Складочная 1с5" error={errors.warehouseAddress} />
          <div className={s.setPair}>
            <Field label="Код города СДЭК" name="cdekCityCode" inputMode="numeric" defaultValue={sup.cdekCityCode ?? ''} placeholder="44 — Москва" error={errors.cdekCityCode} hint="От него считаются тарифы" />
            <Field label="Отгрузка, дней" name="shipDays" type="number" min={0} max={14} defaultValue={sup.shipDays} error={errors.shipDays} />
          </div>
          <Field
            label="Пункт сдачи СДЭК"
            name="cdekShipmentPoint"
            defaultValue={sup.cdekShipmentPoint ?? ''}
            placeholder="MSK65"
            error={errors.cdekShipmentPoint}
            hint="Код пункта СДЭК, куда вы сдаёте посылки — нужен для накладных"
          />
          <div className={s.actions}>
            <Button type="submit" className={s.rowBtn} disabled={pending}>
              {pending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            <Button type="button" variant="outline" className={s.rowBtn} onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Members({ initial }: { initial: Member[] }) {
  const [members, setMembers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'catalog' | 'warehouse'>('catalog');
  return (
    <section className={s.setCard}>
      <h3 className={s.setCardTitle}>Участники и роли</h3>
      {error && <Alert tone="error">{error}</Alert>}
      <ul className={s.memberList}>
          {members.map((m) => (
            <li key={m.userId}>
              <div className={s.memberMain}>
                <span className={s.breakAll}>{m.email}</span>
                {!m.activated && <div className={s.sub}>приглашение отправлено</div>}
              </div>
              <span className={s.muted}>{MEMBER_ROLE_LABEL[m.role]}</span>
                {m.role !== 'owner' && (
                  <button
                    type="button"
                    className={s.textBtn}
                    onClick={async () => {
                      if (!confirm(`Закрыть доступ для ${m.email}?`)) return;
                      setMembers(await api<Member[]>(`/supplier/members/${m.userId}`, undefined, 'DELETE'));
                    }}
                  >
                    Удалить
                  </button>
                )}
            </li>
          ))}
      </ul>
      <form
        className={s.memberInvite}
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
        <input className={s.input} style={{ flex: '1 1 200px', minWidth: 0 }} type="email" required placeholder="email сотрудника" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email сотрудника" />
        <select className={s.input} value={role} onChange={(e) => setRole(e.target.value as 'catalog' | 'warehouse')} aria-label="Роль">
          <option value="catalog">Каталог</option>
          <option value="warehouse">Склад</option>
        </select>
        <Button type="submit" variant="outline" className={s.rowBtn}>
          Пригласить
        </Button>
      </form>
      <p className={s.setNote}>«Каталог» — товары, импорт, контент и акции. «Склад» — заказы и отгрузки.</p>
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
    <section className={s.setCard}>
      <h3 className={s.setCardTitle}>Безопасность</h3>
      <p className={s.setNote}>
        {email} · двухфакторная защита {enabled ? 'включена' : 'выключена'}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {!enabled && !setup && (
        <Button variant="outline" className={s.rowBtn} style={{ justifySelf: 'start' }} onClick={() => run(async () => setSetup(await api('/auth/totp/setup', {})))}>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className={s.input} style={{ flex: '1 1 140px', minWidth: 0 }} inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код" />
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className={s.input} style={{ flex: '1 1 140px', minWidth: 0 }} inputMode="numeric" placeholder="код для отключения" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код" />
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
