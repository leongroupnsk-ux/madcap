'use client';

import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Settings = {
  email: boolean; telegramLinked: boolean; telegramBot: string | null; telegramEnabled: boolean; mutedEvents: string[];
  events: { id: string; label: string }[];
};

/** Уведомления и каналы (ТЗ §7.9): email, Telegram с привязкой кодом, события вкл/выкл. */
export function NotificationSettings() {
  const [st, setSt] = useState<Settings | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Settings>('/supplier/notifications/settings').then(setSt).catch(() => setError('Не удалось загрузить настройки'));
  }, []);

  const run = async (fn: () => Promise<Settings>) => {
    setError(null);
    setSaved(false);
    try {
      setSt(await fn());
      setSaved(true);
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
    }
  };
  const save = (patch: Partial<Pick<Settings, 'email' | 'mutedEvents'>>) =>
    run(() => api<Settings>('/supplier/notifications/settings', { email: patch.email ?? st!.email, mutedEvents: patch.mutedEvents ?? st!.mutedEvents }, 'PUT'));

  return (
    <section className={s.panel} id="notifications">
      <h2>Уведомления</h2>
      {!st ? (
        error && <Alert tone="error">{error}</Alert>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <p className={s.muted}>Все события видны в колокольчике вверху. Здесь — куда ещё их присылать.</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={st.email} onChange={(e) => save({ email: e.target.checked })} />
            Email
          </label>

          <div>
            <b style={{ fontSize: 14 }}>Telegram</b>
            {st.telegramLinked ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                <span className={`${s.badge} ${s.b_active}`}>Подключён</span>
                <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => run(() => api<Settings>('/supplier/notifications/telegram', undefined, 'DELETE'))}>
                  Отвязать
                </button>
              </div>
            ) : !st.telegramEnabled ? (
              <p className={s.muted}>Бот уведомлений ещё не подключён на платформе.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
                <p className={s.muted}>
                  Напишите боту{' '}
                  {st.telegramBot ? (
                    <a className={s.link} href={`https://t.me/${st.telegramBot}`} target="_blank" rel="noreferrer">
                      @{st.telegramBot}
                    </a>
                  ) : (
                    'платформы'
                  )}{' '}
                  команду /start — он пришлёт код. Введите его здесь.
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 140px' }}>
                    <Field label="Код из бота" value={code} inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <Button variant="outline" disabled={code.length !== 6} onClick={() => run(() => api<Settings>('/supplier/notifications/telegram', { code }))}>
                    Привязать
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <b style={{ fontSize: 14 }}>События</b>
            <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
              {st.events.map((ev) => (
                <label key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!st.mutedEvents.includes(ev.id)}
                    onChange={(e) => save({ mutedEvents: e.target.checked ? st.mutedEvents.filter((x) => x !== ev.id) : [...st.mutedEvents, ev.id] })}
                  />
                  {ev.label}
                </label>
              ))}
            </div>
            <p className={s.muted} style={{ marginTop: 6 }}>
              Выключенные события не приходят на почту и в Telegram, но остаются в колокольчике.
            </p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          {saved && !error && <span className={s.muted}>Сохранено</span>}
        </div>
      )}
    </section>
  );
}
