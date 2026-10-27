'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Ключи партнёрского API (только владелец): создать — ключ показывается один раз, отозвать */
export function ApiKeys() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Key[]>('/supplier/api-keys')
      .then(setKeys)
      .catch(() => setError('Не удалось загрузить ключи'));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };
  const active = keys?.filter((k) => !k.revokedAt) ?? [];

  return (
    <section className={s.setCard} aria-labelledby="api-keys-title">
      <div className={s.setCardHead}>
        <h3 className={s.setCardTitle} id="api-keys-title">
          Ключи API
        </h3>
        <Link href="/supplier/api" className={s.textBtn}>
          Как подключить
        </Link>
      </div>
      <p className={s.setNote}>Остатки, цены и заказы из вашей учётной системы. Ключ даёт доступ только к вашему кабинету.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {fresh && (
        <div className={s.apiKeyFresh} role="status">
          <b>Ключ «{fresh.name}» создан.</b> Скопируйте его сейчас — после закрытия он больше не будет показан.
          <code className={s.apiKeyCode} data-testid="api-key-value">
            {fresh.key}
          </code>
          <div className={s.actionsTight}>
            <Button
              type="button"
              variant="outline"
              className={s.rowBtn}
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.key).then(() => setCopied(true), () => undefined);
              }}
            >
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
            <Button type="button" variant="ghost" className={s.rowBtn} onClick={() => (setFresh(null), setCopied(false))}>
              Я сохранил ключ
            </Button>
          </div>
        </div>
      )}
      {active.length > 0 && (
        <ul className={s.memberList} aria-label="Действующие ключи">
          {active.map((k) => (
            <li key={k.id}>
              <div className={s.memberMain}>
                <span className={s.breakAll}>
                  {k.name} · <code>{k.prefix}…</code>
                </span>
                <div className={s.sub}>
                  создан {fmt(k.createdAt)} · {k.lastUsedAt ? `последний запрос ${fmt(k.lastUsedAt)}` : 'ещё не использовался'}
                </div>
              </div>
              <button
                type="button"
                className={s.textBtn}
                aria-label={`Отозвать ключ ${k.name}`}
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Отозвать ключ «${k.name}»? Запросы с ним перестанут работать сразу.`)) return;
                  void run(async () => setKeys(await api<Key[]>(`/supplier/api-keys/${k.id}`, undefined, 'DELETE')));
                }}
              >
                Отозвать
              </button>
            </li>
          ))}
        </ul>
      )}
      {keys && !active.length && !fresh && <p className={s.setNote}>Действующих ключей нет.</p>}
      <form
        className={s.setForm}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api<{ key: string; item: Key }>('/supplier/api-keys', { name });
            setFresh({ key: r.key, name: r.item.name });
            setCopied(false);
            setKeys((prev) => [r.item, ...(prev ?? [])]);
            setName('');
          });
        }}
      >
        <Field label="Название ключа" name="apiKeyName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, 1С: склад" maxLength={60} required />
        <Button type="submit" variant="outline" className={s.rowBtn} style={{ justifySelf: 'start' }} disabled={busy || !name.trim()}>
          Создать ключ
        </Button>
      </form>
    </section>
  );
}
