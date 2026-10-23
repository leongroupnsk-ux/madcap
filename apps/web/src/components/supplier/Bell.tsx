'use client';

import { plural } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import s from './cabinet.module.css';

type Item = { id: string; title: string; body: string; link: string | null; read: boolean; createdAt: string };
type Data = { unread: number; items: Item[] };

const ago = (d: string) => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  if (min < 1440) return `${Math.round(min / 60)} ч назад`;
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

/** Центр уведомлений кабинета (ТЗ §7.9): счётчик непрочитанных, список событий со ссылками, «прочитано». */
export function Bell() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();

  const load = useCallback(() => api<Data>('/supplier/notifications').then(setData).catch(() => undefined), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const read = async (ids?: string[]) => setData(await api<Data>('/supplier/notifications/read', ids ? { ids } : {}));

  return (
    <div className={s.bell} ref={box}>
      <button className={s.bellBtn} onClick={() => setOpen((v) => !v)} aria-label={`Уведомления${data?.unread ? `: ${data.unread} ${plural(data.unread, 'новое', 'новых', 'новых')}` : ''}`} aria-expanded={open}>
        🔔
        {!!data?.unread && <span className={s.bellCount}>{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className={s.bellPanel} role="dialog" aria-label="Уведомления">
          <div className={s.bellHead}>
            <b>Уведомления</b>
            {!!data?.unread && (
              <button className={s.link} style={{ border: 0, background: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => read()}>
                Прочитать все
              </button>
            )}
          </div>
          {!data?.items.length && <p className={s.muted} style={{ padding: 14 }}>Пока ничего нет.</p>}
          {data?.items.map((n) => {
            const content = (
              <>
                <b>{n.title}</b>
                {n.body && <span className={s.muted}>{n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body}</span>}
                <div className={s.muted} style={{ fontSize: 11, marginTop: 4 }}>
                  {ago(n.createdAt)}
                </div>
              </>
            );
            const cls = n.read ? s.bellItem : s.bellUnread;
            return n.link ? (
              <Link key={n.id} href={n.link} className={cls} onClick={() => !n.read && void read([n.id])}>
                {content}
              </Link>
            ) : (
              <div key={n.id} className={cls} onClick={() => !n.read && void read([n.id])}>
                {content}
              </div>
            );
          })}
          <Link href="/supplier/settings#notifications" className={s.bellItem} style={{ textAlign: 'center' }}>
            Настроить уведомления
          </Link>
        </div>
      )}
    </div>
  );
}
