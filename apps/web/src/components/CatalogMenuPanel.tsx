'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { MegaMenuData } from './CatalogMenu';
import m from './catalog-menu.module.css';

const MOBILE = '(max-width: 900px)';
const FOCUSABLE = 'a[href], button:not([disabled])';

/** Колонка «Подбор» — постоянные пункты; бренды и специальности — из фасетов каталога */
const PICKS = [
  { href: '/quiz/1', label: 'Подобрать капсулу', hint: 'Анкета из 6 шагов — соберём комплект под вас', cls: 'pickCapsule' },
  { href: '/catalog?sale=1', label: 'Распродажа', hint: 'Товары со скидкой и акции', cls: 'pickSale' },
  { href: '/premium', label: 'Премиум', hint: 'Премиум-коллекция и персональный подбор', cls: 'pickPremium' },
] as const;

/**
 * Панель мегаменю (грузится лениво из CatalogMenu).
 * Десктоп: слева разделы, при наведении/фокусе справа — подразделы активного; подразделы идут в DOM сразу
 * за своим разделом, поэтому Tab проходит «раздел → его подразделы → следующий раздел».
 * Телефон (≤ 900 px): полноэкранная панель, разделы раскрываются аккордеоном, Tab ходит по кругу внутри.
 */
export function CatalogMenuPanel({ data, open, onClose }: { data: MegaMenuData; open: boolean; onClose: (refocus?: boolean) => void }) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Телефон: фокус в панель, страница под ней не прокручивается, Tab не уходит за панель
  useEffect(() => {
    if (!open || !window.matchMedia(MOBILE).matches) return;
    closeBtn.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      const box = root.current;
      if (e.key !== 'Tab' || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => () => clearTimeout(hover.current), []);
  // Каждое открытие — с первого раздела и со свёрнутым аккордеоном
  useEffect(() => {
    if (!open) return;
    setActive(0);
    setExpanded(null);
  }, [open]);

  // Клик по любой ссылке меню закрывает его (и при переходе на тот же адрес с другими параметрами);
  // панель при этом только прячется, переход Next.js идёт своим чередом
  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) onClose();
  };

  // Небольшая задержка при наведении: курсор, идущий наискосок к подразделам, не переключает раздел
  const hoverTo = (i: number) => {
    clearTimeout(hover.current);
    hover.current = setTimeout(() => setActive(i), 90);
  };

  return (
    <div ref={root} className={m.panel} onClick={onClick}>
      <div className={m.mobileHead}>
        <span className={m.mobileTitle}>Каталог</span>
        <button ref={closeBtn} type="button" className={m.close} aria-label="Закрыть каталог" onClick={() => onClose(true)}>
          ×
        </button>
      </div>
      <nav className={`container ${m.grid}`} aria-label="Каталог">
        <div className={m.catsCol}>
          <div className="eyebrow">Разделы</div>
          <ul className={m.cats}>
            {data.categories.map((c, i) => {
              const subId = `mega-sub-${c.slug}`;
              const isOpen = expanded === c.slug;
              return (
                <li
                  key={c.slug}
                  className={`${m.cat} ${i === active ? m.catActive : ''} ${isOpen ? m.catOpen : ''}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && hoverTo(i)}
                  onPointerLeave={() => clearTimeout(hover.current)}
                  onFocus={() => {
                    clearTimeout(hover.current);
                    setActive(i);
                  }}
                >
                  <div className={m.catRow}>
                    <Link href={`/catalog/${c.slug}`} className={m.catLink}>
                      {c.name}
                    </Link>
                    {c.children.length > 0 && (
                      <button
                        type="button"
                        className={m.toggle}
                        aria-expanded={isOpen}
                        aria-controls={subId}
                        aria-label={`Подразделы: ${c.name}`}
                        onClick={() => setExpanded(isOpen ? null : c.slug)}
                      >
                        <img src="/design/icons/chevron-down.svg" alt="" width={10} height={6} />
                      </button>
                    )}
                  </div>
                  <div className={m.sub} id={subId}>
                    <Link href={`/catalog/${c.slug}`} className={m.subAll}>
                      Все товары раздела «{c.name}» →
                    </Link>
                    {c.children.length > 0 ? (
                      <ul className={m.subList}>
                        {c.children.map((ch) => (
                          <li key={ch.slug}>
                            <Link href={`/catalog/${ch.slug}`}>{ch.name}</Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={m.subNote}>Фильтры по размеру, ростовке, цвету и специальности — на странице раздела.</p>
                    )}
                  </div>
                </li>
              );
            })}
            <li className={m.cat}>
              <div className={m.catRow}>
                <Link href="/catalog" className={m.catLink}>
                  Весь каталог
                </Link>
              </div>
            </li>
          </ul>
        </div>

        <div className={m.side}>
          <div className="eyebrow">Подбор</div>
          <ul className={m.picks}>
            {PICKS.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className={`${m.pick} ${m[p.cls]}`}>
                  <b>{p.label}</b>
                  <span>{p.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
          {data.brands.length > 0 && (
            <>
              <div className="eyebrow">Популярные бренды</div>
              <ul className={m.chips}>
                {data.brands.map((b) => (
                  <li key={b.href}>
                    <Link href={b.href}>{b.name}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.specialties.length > 0 && (
            <>
              <div className="eyebrow">Специальности</div>
              <ul className={m.chips}>
                {data.specialties.map((sp) => (
                  <li key={sp.href}>
                    <Link href={sp.href}>{sp.name}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Link href="/how" className={m.howLink}>
            Как это работает →
          </Link>
        </div>
      </nav>
    </div>
  );
}
