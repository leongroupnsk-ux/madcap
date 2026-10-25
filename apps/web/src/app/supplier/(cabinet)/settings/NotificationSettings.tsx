'use client';

import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Settings = {
  email: boolean; telegramLinked: boolean; telegramBot: string | null; telegramEnabled: boolean; mutedEvents: string[];
  events: { id: string; label: string }[];
};

/** Переключатель-«тумблер» из макета: настоящий checkbox, оформленный как toggle. */
function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={s.toggleRow}>
      <input type="checkbox" role="switch" className={s.toggle} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Уведомления и каналы (ТЗ §7.9): email, Telegram с привязкой кодом, события вкл/выкл. */
export function NotificationSettings({ email }: { email: string }) {
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
    <section className={`${s.panel} ${s.setMain}`} id="notifications">
      <h2>Уведомления и каналы</h2>
      {!st ? (
        error && <Alert tone="error">{error}</Alert>
      ) : (
        <>
          <div className={s.toggleList}>
            <Toggle checked={st.email} onChange={(v) => save({ email: v })}>
              Email · {email}
            </Toggle>
            {st.telegramLinked ? (
              <div className={s.toggleRow}>
                <input type="checkbox" role="switch" className={s.toggle} checked readOnly aria-label="Telegram привязан" />
                <span>
                  Telegram · привязан{' '}
                  <button type="button" className={s.textBtn} onClick={() => run(() => api<Settings>('/supplier/notifications/telegram', undefined, 'DELETE'))}>
                    Отвязать
                  </button>
                </span>
              </div>
            ) : (
              <div className={s.toggleRow}>
                <input type="checkbox" role="switch" className={s.toggle} checked={false} disabled aria-label="Telegram не привязан" />
                <span>Telegram · не привязан</span>
              </div>
            )}
          </div>
          {!st.telegramLinked &&
            (!st.telegramEnabled ? (
              <p className={s.setNote}>Бот уведомлений ещё не подключён на платформе.</p>
            ) : (
              <div className={s.tgLink}>
                <p className={s.setNote}>
                  Привязка Telegram: бот{' '}
                  {st.telegramBot ? (
                    <a className={s.link} href={`https://t.me/${st.telegramBot}`} target="_blank" rel="noreferrer">
                      @{st.telegramBot}
                    </a>
                  ) : (
                    'платформы'
                  )}{' '}
                  выдаёт код по /start — введите его здесь.
                </p>
                <div className={s.tgForm}>
                  <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                    <Field label="Код из бота" value={code} inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <Button variant="outline" className={s.rowBtn} disabled={code.length !== 6} onClick={() => run(() => api<Settings>('/supplier/notifications/telegram', { code }))}>
                    Привязать
                  </Button>
                </div>
              </div>
            ))}
          {st.telegramLinked && <p className={s.setNote}>Все события видны в колокольчике вверху. Здесь — куда ещё их присылать.</p>}

          <h2 className={s.setH}>События</h2>
          <div className={s.toggleList}>
            {st.events.map((ev) => (
              <Toggle
                key={ev.id}
                checked={!st.mutedEvents.includes(ev.id)}
                onChange={(on) => save({ mutedEvents: on ? st.mutedEvents.filter((x) => x !== ev.id) : [...st.mutedEvents, ev.id] })}
              >
                {ev.label}
              </Toggle>
            ))}
          </div>
          <p className={s.setNote}>Выключенные события не приходят на почту и в Telegram, но остаются в колокольчике.</p>
          {error && <Alert tone="error">{error}</Alert>}
          {saved && !error && (
            <p className={s.setNote} role="status">
              Сохранено
            </p>
          )}
        </>
      )}
    </section>
  );
}
