'use client';

import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import site from '../site.module.css';
import s from './search.module.css';

type Suggest = {
  products: { slug: string; title: string; brand: string; price: number; image: string | null }[];
  categories: { name: string; slug: string }[];
  brands: { name: string; slug: string }[];
};

/** Поиск в шапке с подсказками после 2 символов (ТЗ §4.1). */
export function SearchBox() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(path === '/search' ? (params.get('q') ?? '') : '');
  const [data, setData] = useState<Suggest | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/catalog/suggest?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then(setData)
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => setOpen(false), [path]);

  const empty = data && !data.products.length && !data.categories.length && !data.brands.length;
  return (
    <form
      ref={box}
      className={`${site.search} ${s.wrap}`}
      action="/search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
        setOpen(false);
      }}
    >
      <label htmlFor="q" className="visually-hidden">
        Поиск по каталогу
      </label>
      <input
        id="q"
        name="q"
        type="search"
        autoComplete="off"
        placeholder="Скраб-костюм, халат, сабо, шапочка…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      <button type="submit" aria-label="Найти">
        ⌕
      </button>
      {open && data && (
        <div className={s.panel} role="listbox">
          {empty && <div className={s.empty}>Ничего не нашли по «{q}»</div>}
          {data.categories.length + data.brands.length > 0 && (
            <div className={s.links}>
              {data.categories.map((c) => (
                <Link key={c.slug} href={`/catalog/${c.slug}`} className={s.pill}>
                  {c.name}
                </Link>
              ))}
              {data.brands.map((b) => (
                <Link key={b.slug} href={`/catalog?brand=${b.slug}`} className={s.pill}>
                  {b.name}
                </Link>
              ))}
            </div>
          )}
          {data.products.map((p) => (
            <Link key={p.slug} href={`/product/${p.slug}`} className={s.row}>
              {p.image ? <img src={p.image} alt="" /> : <span className={s.noimg} />}
              <span>
                <b>{p.title}</b>
                <small>{p.brand}</small>
              </span>
              <span className={s.price}>{formatRub(p.price)}</span>
            </Link>
          ))}
          {!empty && (
            <Link href={`/search?q=${encodeURIComponent(q.trim())}`} className={s.all}>
              Все результаты →
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
