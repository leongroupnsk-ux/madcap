'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import s from './site.module.css';

/** Данные мегаменю — собираются на сервере в SiteHeader (справочник категорий и фасеты каталога). */
export type MegaMenuData = {
  categories: { name: string; slug: string; children: { name: string; slug: string }[] }[];
  brands: { name: string; href: string }[];
  specialties: { name: string; href: string }[];
};

export const MENU_ID = 'catalog-menu';

// Сама панель — отдельный чанк: грузится при первом открытии (или чуть раньше — при наведении/фокусе на кнопку),
// поэтому JS шапки на каждой странице не растёт (docs/PERF.md).
const loadPanel = () => import('./CatalogMenuPanel');
const Panel = dynamic(() => loadPanel().then((m) => m.CatalogMenuPanel), { ssr: false, loading: () => null });

/** Десктоп с мышью: там меню открывается и наведением. Граница — как у мобильной шапки (site.module.css, 900 px). */
const hoverDesktop = () => window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 901px)').matches;

type Mode = false | 'hover' | 'click';

/**
 * Кнопка «Каталог» с мегаменю. Без JS это обычная ссылка на /catalog; с JS клик (Enter) открывает панель,
 * Ctrl/Cmd-клик и средняя кнопка по-прежнему открывают каталог в новой вкладке.
 * Открытое наведением меню закрывается, когда курсор ушёл; открытое кликом — по Escape, клику вне, переходу.
 */
export function CatalogMenu({ data }: { data: MegaMenuData }) {
  const [open, setOpen] = useState<Mode>(false);
  // Панель после первого открытия остаётся смонтированной и просто прячется: если размонтировать её
  // во время клика по ссылке внутри, Next.js не доводит переход до конца
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pathname = usePathname();

  const clearTimer = () => clearTimeout(timer.current);
  const close = useCallback((refocus = false) => {
    clearTimeout(timer.current);
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);

  // Переход на другую страницу закрывает меню
  useEffect(() => close(), [pathname, close]);
  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Фокус возвращаем на кнопку, если он был в меню или меню открыли кликом/с клавиатуры
      close(open === 'click' || !!wrap.current?.contains(document.activeElement));
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, close]);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    clearTimer();
    // Открытое наведением меню клик «закрепляет», а не закрывает
    setOpen((m) => (m === 'click' ? false : 'click'));
  };

  return (
    <div
      ref={wrap}
      className={s.catalogWrap}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse' || !hoverDesktop()) return;
        clearTimer();
        void loadPanel();
        if (!open) timer.current = setTimeout(() => setOpen((m) => m || 'hover'), 180);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimer();
        if (open === 'hover' || !open) timer.current = setTimeout(() => setOpen((m) => (m === 'hover' ? false : m)), 280);
      }}
      onBlur={(e) => {
        // Фокус ушёл из кнопки и панели (Tab дальше по шапке) — меню закрывается
        const to = e.relatedTarget as Node | null;
        if (to && !wrap.current?.contains(to)) close();
      }}
    >
      <a
        ref={btn}
        href="/catalog"
        className={s.catalogBtn}
        aria-expanded={!!open}
        aria-controls={MENU_ID}
        onClick={onClick}
        onFocus={() => void loadPanel()}
      >
        <img src="/design/icons/catalog.svg" alt="" width={16} height={16} /> Каталог
      </a>
      {/* Контейнер есть всегда, чтобы aria-controls указывал на существующий элемент */}
      <div id={MENU_ID} hidden={!open} className={s.megaHost}>
        {(open || mounted) && <Panel data={data} open={!!open} onClose={close} />}
      </div>
    </div>
  );
}
