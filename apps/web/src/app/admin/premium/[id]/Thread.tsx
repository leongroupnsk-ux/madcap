'use client';

import { PREMIUM_MESSAGE_CHANNELS, PREMIUM_MESSAGE_STATUSES, premiumMessageSchema, type PremiumMessageStatus } from '@aesculap/shared';
import { useEffect, useRef, useState } from 'react';
import cab from '@/components/admin/admin.module.css';
import { Alert, Button, Chip } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import t from '../thread.module.css';

export type ThreadMessage = {
  id: string; direction: 'incoming' | 'outgoing'; channel: keyof typeof PREMIUM_MESSAGE_CHANNELS; text: string; status: PremiumMessageStatus;
  error: string | null; staff: string | null; readAt: string | null; createdAt: string;
};
export type TelegramInfo = { available: boolean; linked: boolean; linkedAt: string | null; linkPending: boolean; linkExpiresAt: string | null };

const date = (d: string) => new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Переписка по заявке: лента (входящие из Telegram, ответы менеджера, заметки о WhatsApp) и поле ответа.
 * Telegram — через бота платформы, если клиент привязал чат; WhatsApp — без API: менеджер пишет со своего
 * телефона по ссылке wa.me и записывает в ленту, что отправил («вне системы»).
 */
export function Thread({
  leadId, name, messages, telegram, whatsappUrl, onChange,
}: { leadId: string; name: string; messages: ThreadMessage[]; telegram: TelegramInfo; whatsappUrl: string; onChange: () => Promise<unknown> }) {
  const canTelegram = telegram.available && telegram.linked;
  const [channel, setChannel] = useState<'telegram' | 'whatsapp'>(canTelegram ? 'telegram' : 'whatsapp');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const feed = useRef<HTMLOListElement>(null);
  const unread = messages.filter((m) => m.direction === 'incoming' && !m.readAt).length;

  useEffect(() => {
    if (canTelegram) setChannel('telegram');
  }, [canTelegram]);
  // Новые сообщения внизу — прокручиваем ленту к последнему
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [messages.length]);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setMsg(null);
    try {
      const ok = await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером' });
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      const parsed = premiumMessageSchema.safeParse({ channel, text });
      if (!parsed.success) throw { status: 400, message: parsed.error.issues[0]?.message ?? 'Проверьте текст' };
      const r = await api<{ status: PremiumMessageStatus; error: string | null }>(`/admin/premium/${leadId}/messages`, parsed.data);
      setText('');
      await onChange();
      if (r.status === 'failed') throw { status: 502, message: `Telegram не принял сообщение: ${r.error ?? 'ошибка'}` };
      return channel === 'telegram' ? 'Отправлено в Telegram' : 'Заметка добавлена';
    });

  return (
    <section className={cab.panel} aria-labelledby="thread-title">
      <h2 id="thread-title">
        Переписка
        {unread > 0 && (
          <span className={t.unread}>
            {unread}
            <span className="visually-hidden"> непрочитанных</span>
          </span>
        )}
      </h2>
      {messages.length ? (
        <ol ref={feed} className={t.feed} aria-label="Лента переписки" tabIndex={0}>
          {messages.map((m) => {
            const cls = m.direction === 'incoming' ? t.in : m.channel === 'telegram' ? t.out : t.note;
            const isUnread = m.direction === 'incoming' && !m.readAt;
            return (
              <li key={m.id} className={`${t.msg} ${cls} ${isUnread ? t.unreadMsg : ''}`}>
                <div className={t.meta}>
                  <span>{m.direction === 'incoming' ? name : (m.staff ?? 'Менеджер')}</span>
                  <span>{m.channel === 'whatsapp' && m.direction === 'outgoing' ? 'написал в WhatsApp' : PREMIUM_MESSAGE_CHANNELS[m.channel]}</span>
                  <time dateTime={m.createdAt}>{date(m.createdAt)}</time>
                  <span className={m.status === 'failed' ? t.failed : undefined}>{PREMIUM_MESSAGE_STATUSES[m.status]}</span>
                  {isUnread && <b>новое</b>}
                </div>
                <p>{m.text}</p>
                {m.error && <div className={`${t.meta} ${t.failed}`}>{m.error}</div>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={cab.muted}>Сообщений пока нет.</p>
      )}
      {unread > 0 && (
        <p>
          <Button variant="outline" disabled={busy} onClick={() => run(async () => (await api(`/admin/premium/${leadId}/read`, {}), await onChange(), 'Отмечено прочитанным'))}>
            Отметить прочитанным
          </Button>
        </p>
      )}

      <div className={t.tabs} role="group" aria-label="Канал ответа">
        <Chip active={channel === 'telegram'} disabled={!canTelegram} onClick={() => setChannel('telegram')}>
          Telegram
        </Chip>
        <Chip active={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')}>
          Заметка о WhatsApp
        </Chip>
      </div>
      <div className={t.reply}>
        <label htmlFor="thread-text" className={cab.muted}>
          {channel === 'telegram' ? 'Ответ клиенту — уйдёт в Telegram от бота платформы' : 'Что написали клиенту в WhatsApp (запись в ленте, клиенту не отправляется)'}
        </label>
        <textarea id="thread-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} rows={4} />
        <div className={t.actions}>
          <Button disabled={busy || !text.trim() || (channel === 'telegram' && !canTelegram)} onClick={send}>
            {channel === 'telegram' ? 'Отправить в Telegram' : 'Добавить заметку'}
          </Button>
          <a className={cab.link} href={whatsappUrl} target="_blank" rel="noreferrer">
            Написать в WhatsApp
          </a>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <p className={cab.muted} style={{ marginTop: 12 }}>
        {!telegram.available
          ? 'Telegram-бот платформы не подключён (TELEGRAM_BOT_TOKEN) — переписка в Telegram недоступна.'
          : telegram.linked
            ? `Telegram привязан${telegram.linkedAt ? ` ${date(telegram.linkedAt)}` : ''}: входящие сообщения клиента появляются в ленте.`
            : telegram.linkPending && telegram.linkExpiresAt
              ? `Клиент ещё не открыл ссылку на бота (действует до ${date(telegram.linkExpiresAt)}).`
              : 'Клиент не привязал Telegram.'}
      </p>
      {telegram.available && (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api<{ url: string }>(`/admin/premium/${leadId}/telegram-link`, {});
                setLink(r.url);
                await onChange();
                return 'Новая ссылка создана — прежняя больше не действует';
              })
            }
          >
            {telegram.linked ? 'Новая ссылка на бота (перепривязать)' : 'Ссылка на бота для клиента'}
          </Button>
          {link && (
            <label className={t.copy}>
              <span className={cab.muted}>Отправьте ссылку клиенту (SMS, WhatsApp): одноразовая, 7 дней</span>
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
        </>
      )}
    </section>
  );
}
