'use client';

import { plural } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import s from './shell.module.css';

type Item = { id: string; title: string; body: string; link: string | null; read: boolean; createdAt: string };
type Data = { unread: number; items: Item[] };

const ago = (d: string) => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  if (min < 1440) return `${Math.round(min / 60)} ч назад`;
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

/** Закрытие всплывающей панели шапки по клику мимо, Escape и переходу на другую страницу. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();
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
  return { open, setOpen, box };
}

/** Центр уведомлений кабинета (ТЗ §7.9, кадр note-partner): счётчик непрочитанных, список событий со ссылками, «прочитано». */
export function Bell() {
  const [data, setData] = useState<Data | null>(null);
  const { open, setOpen, box } = usePopover();

  const load = useCallback(() => api<Data>('/supplier/notifications').then(setData).catch(() => undefined), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const read = async (ids?: string[]) => setData(await api<Data>('/supplier/notifications/read', ids ? { ids } : {}));

  return (
    <div className={s.pop} ref={box}>
      <button
        type="button"
        className={s.bellBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Уведомления${data?.unread ? `: ${data.unread} ${plural(data.unread, 'новое', 'новых', 'новых')}` : ''}`}
        aria-expanded={open}
      >
        <img src="/design/icons/sup-bell.svg" alt="" width={20} height={20} />
        {!!data?.unread && <span className={s.bellCount}>{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className={`${s.panel} ${s.bellPanel}`} role="dialog" aria-label="Уведомления">
          <div className={s.panelHead}>
            <span className={s.panelTitle}>Уведомления</span>
            {!!data?.unread && (
              <button type="button" className={s.textBtn} onClick={() => void read()}>
                Прочитать все
              </button>
            )}
          </div>
          {!data?.items.length && <p className={s.empty}>Пока ничего нет.</p>}
          {!!data?.items.length && (
            <div className={s.list}>
              {data.items.map((n) => {
                const content = (
                  <>
                    <span className={s.dot} />
                    <span className={s.itemText}>
                      <b>{n.title}</b>
                      {n.body && <span>{n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body}</span>}
                      <span>{ago(n.createdAt)}</span>
                    </span>
                  </>
                );
                const cls = `${s.item} ${n.read ? '' : s.unread}`;
                const onClick = () => !n.read && void read([n.id]);
                return n.link ? (
                  <Link key={n.id} href={n.link} className={cls} onClick={onClick}>
                    {content}
                  </Link>
                ) : (
                  <div key={n.id} className={cls} onClick={onClick}>
                    {content}
                  </div>
                );
              })}
            </div>
          )}
          <div className={s.panelFoot}>
            <Link href="/supplier/settings#notifications">Настроить уведомления →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
