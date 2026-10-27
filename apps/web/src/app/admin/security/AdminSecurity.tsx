'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

/** Включение и отключение входа по коду из приложения-аутентификатора (TOTP). */
export function AdminSecurity({ enabled: initial, setupRequired }: { enabled: boolean; setupRequired: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
    }
  };

  return (
    <section className={s.panel} style={{ marginTop: 12, maxWidth: 560, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Двухфакторная защита</h2>
      {setupRequired && !enabled && (
        <Alert tone="error">
          Для вашей роли вход в админку возможен только с кодом из приложения. Пока двухфакторная защита не включена, остальные разделы закрыты — это займёт минуту.
        </Alert>
      )}
      {done && <Alert tone="success">Готово: при следующем входе понадобится код из приложения.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      <p className={s.muted} style={{ margin: 0 }}>
        Сейчас {enabled ? 'включена' : 'выключена'}. При входе после пароля нужно ввести 6 цифр из приложения-аутентификатора. Потеряли телефон — попросите администратора сервера сбросить 2FA.
      </p>
      {!enabled && !setup && (
        <Button style={{ justifySelf: 'start' }} onClick={() => run(async () => setSetup(await api('/auth/totp/setup', {})))}>
          Включить вход по коду
        </Button>
      )}
      {setup && !enabled && (
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14 }}>1. Добавьте ключ в Google Authenticator, Яндекс Ключ или 1Password:</p>
          <code style={{ background: 'var(--c-bg)', padding: 10, borderRadius: 8, wordBreak: 'break-all' }}>{setup.secret}</code>
          <a className={s.link} href={setup.otpauthUrl}>
            Открыть в приложении на этом устройстве
          </a>
          <p style={{ margin: 0, fontSize: 14 }}>2. Введите 6 цифр, которые показывает приложение:</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className={s.input} style={{ flex: '1 1 140px', minWidth: 0 }} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код из приложения" />
            <Button
              onClick={() =>
                run(async () => {
                  await api('/auth/totp/enable', { code });
                  setEnabled(true);
                  setSetup(null);
                  setCode('');
                  setDone(true);
                  // Админка открылась — перерисовать меню из layout
                  if (setupRequired) router.refresh();
                })
              }
            >
              Подтвердить
            </Button>
          </div>
        </div>
      )}
      {enabled && !done && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className={s.input} style={{ flex: '1 1 140px', minWidth: 0 }} inputMode="numeric" placeholder="код для отключения" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Код для отключения" />
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
      <Button
        variant="ghost"
        style={{ justifySelf: 'start' }}
        onClick={() =>
          run(async () => {
            await api('/auth/logout', {});
            router.replace('/login?next=/admin');
            router.refresh();
          })
        }
      >
        Выйти
      </Button>
    </section>
  );
}
