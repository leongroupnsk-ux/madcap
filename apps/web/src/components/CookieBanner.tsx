'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from './site.module.css';

const KEY = 'cookie-consent';

/** Аналитика подключается только при значении "all" (ТЗ §4.1, §10). */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(!localStorage.getItem(KEY));
    } catch {
      setOpen(true);
    }
  }, []);
  const choose = (value: 'all' | 'essential') => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* приватный режим — баннер просто закроется */
    }
    setOpen(false);
  };
  if (!open) return null;
  return (
    <div className={s.cookie} role="region" aria-label="Cookies">
      <p>
        Мы используем cookies: необходимые — для работы сайта, аналитические — только с вашего согласия.{' '}
        <Link href="/legal/privacy">Подробнее</Link>
      </p>
      <div className={s.cookieActions}>
        <button className={s.cookieBtn} onClick={() => choose('essential')}>
          Только необходимые
        </button>
        <button className={`${s.cookieBtn} ${s.cookieBtnMain}`} onClick={() => choose('all')}>
          Разрешить все
        </button>
      </div>
    </div>
  );
}
