'use client';

import { plural } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useEscape } from '@/components/ui';
import type { Card, CatalogList, Facets } from '@/lib/catalog';
import c from './catalog.module.css';
import { ProductCard } from './ProductCard';
import s from './shop.module.css';

const GENDER = { male: 'Мужской', female: 'Женский', unisex: 'Унисекс' } as const;
const GENDER_ORDER = ['male', 'female', 'unisex'] as const;

function useParamsNav() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const go = (next: URLSearchParams) => {
    next.delete('page');
    const q = next.toString();
    router.push(q ? `${path}?${q}` : path, { scroll: false });
  };
  return { params, go, path };
}

/** Раздел каталога из адреса: /catalog/<slug> — API получает его параметром category. */
const categoryOf = (path: string) => (path.startsWith('/catalog/') ? path.split('/')[2] : undefined);

/** «Сортировка: Рекомендуемые ▾» — выпадающий список-пилюля из макета. */
export function SortSelect() {
  const { params, go } = useParamsNav();
  return (
    <label className={c.sort}>
      Сортировка:
      <select
        className={c.select}
        value={params.get('sort') ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set('sort', e.target.value);
          else next.delete('sort');
          go(next);
        }}
      >
        <option value="">Рекомендуемые</option>
        <option value="new">Новинки</option>
        <option value="price_asc">Сначала дешевле</option>
        <option value="price_desc">Сначала дороже</option>
      </select>
    </label>
  );
}

/**
 * Панель «Фильтры» — кадр filter макета (ТЗ §4.4): выбор копится локально, кнопка показывает,
 * сколько товаров найдётся, и применяет фильтры — они попадают в URL.
 */
export function FiltersPanel({ facets, active, personal }: { facets: Facets; active: number; personal: boolean }) {
  const { params, go, path } = useParamsNav();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new URLSearchParams(params));
  const [found, setFound] = useState<number | null>(null);
  useEffect(() => setDraft(new URLSearchParams(params)), [params]);

  // Счётчик на кнопке «Показать N товаров»: та же выдача с текущим черновиком фильтров
  useEffect(() => {
    if (!open) return;
    const q = new URLSearchParams(draft);
    q.delete('page');
    q.set('perPage', '1');
    const category = categoryOf(path);
    if (category) q.set('category', category);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/catalog/products?${q}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<CatalogList>) : null))
        .then((d) => setFound(d ? d.total : null))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [draft, open, path]);

  const has = (k: string, v: string) => draft.getAll(k).includes(v);
  const toggle = (k: string, v: string) => {
    const next = new URLSearchParams(draft);
    const vals = next.getAll(k);
    next.delete(k);
    (vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v]).forEach((x) => next.append(k, x));
    setDraft(next);
  };
  const setOne = (k: string, v: string) => {
    const next = new URLSearchParams(draft);
    if (v) next.set(k, v);
    else next.delete(k);
    setDraft(next);
  };
  const close = () => setOpen(false);
  const Opt = ({ k, v, label, swatch }: { k: string; v: string; label: string; swatch?: string }) => (
    <button type="button" className={`${c.opt} ${swatch ? c.optColor : ''} ${has(k, v) ? c.optOn : ''}`} onClick={() => toggle(k, v)} aria-pressed={has(k, v)}>
      {swatch && <span className={c.swatch} style={{ background: swatch }} />}
      {label}
    </button>
  );
  const genders = GENDER_ORDER.filter((g) => facets.genders.some((x) => x.value === g));
  const fitOn = draft.get('fit') === '1';

  return (
    <>
      <button type="button" className={c.filterBtn} onClick={() => setOpen(true)}>
        Фильтры{active > 0 && <span className={c.count}>{active}</span>}
      </button>
      {open && (
        <FilterSheet onClose={close}>
          <div className={c.sheetBody}>
            {genders.length > 0 && (
              <div className={c.group}>
                <h3>Пол</h3>
                <div className={c.opts}>
                  {genders.map((g) => (
                    <Opt key={g} k="gender" v={g} label={GENDER[g]} />
                  ))}
                </div>
              </div>
            )}
            {facets.sizes.length > 0 && (
              <div className={c.group}>
                <h3>Размер</h3>
                <div className={c.opts}>
                  {facets.sizes.map((f) => (
                    <Opt key={f.value} k="size" v={f.value} label={f.value} />
                  ))}
                </div>
              </div>
            )}
            {facets.heights.length > 0 && (
              <div className={c.group}>
                <h3>Ростовка</h3>
                <div className={c.opts}>
                  {facets.heights.map((f) => (
                    <Opt key={f.value} k="height" v={f.value} label={f.value} />
                  ))}
                </div>
              </div>
            )}
            {facets.colors.length > 0 && (
              <div className={c.group}>
                <h3>Цвет</h3>
                <div className={`${c.opts} ${c.optsColor}`}>
                  {facets.colors.map((f) => (
                    <Opt key={f.id} k="color" v={f.id} label={f.name} swatch={f.hex} />
                  ))}
                </div>
              </div>
            )}
            <div className={c.group}>
              <h3>Цена</h3>
              <div className={c.range}>
                <label>
                  От
                  <input inputMode="numeric" placeholder={Math.floor(facets.price.min / 100).toLocaleString('ru-RU')} value={draft.get('priceFrom') ?? ''} onChange={(e) => setOne('priceFrom', e.target.value.replace(/\D/g, ''))} />
                </label>
                <label>
                  До
                  <input inputMode="numeric" placeholder={Math.ceil(facets.price.max / 100).toLocaleString('ru-RU')} value={draft.get('priceTo') ?? ''} onChange={(e) => setOne('priceTo', e.target.value.replace(/\D/g, ''))} />
                </label>
              </div>
              <div className={c.opts}>
                <Opt k="sale" v="1" label="Только со скидкой" />
              </div>
            </div>
            {facets.specialties.length > 0 && (
              <div className={c.group}>
                <h3>Специальность</h3>
                <div className={c.opts}>
                  {facets.specialties.map((f) => (
                    <Opt key={f.id} k="specialty" v={f.id} label={f.name} />
                  ))}
                </div>
              </div>
            )}
            {facets.brands.length > 0 && (
              <div className={c.group}>
                <h3>Бренд</h3>
                <div className={c.opts}>
                  {facets.brands.map((f) => (
                    <Opt key={f.slug} k="brand" v={f.slug} label={f.name} />
                  ))}
                </div>
              </div>
            )}
            {personal ? (
              <button type="button" className={`${c.fitCard} ${fitOn ? c.fitOn : ''}`} role="switch" aria-checked={fitOn} onClick={() => setOne('fit', fitOn ? '' : '1')}>
                <span>
                  <b>Только подходящее вам</b>
                  <small>По размеру, цветам и предпочтениям</small>
                </span>
                <span className={c.fitMark} aria-hidden />
              </button>
            ) : (
              <Link href="/quiz" className={c.fitCard} onClick={close}>
                <span>
                  <b>Только подходящее вам</b>
                  <small>Пройдите подбор — покажем вещи по размеру и предпочтениям</small>
                </span>
                <span className={c.fitArrow} aria-hidden>
                  →
                </span>
              </Link>
            )}
          </div>
          <div className={c.sheetFoot}>
            <button
              type="button"
              className={c.reset}
              onClick={() => {
                const keep = new URLSearchParams();
                ['q', 'sort'].forEach((k) => params.get(k) && keep.set(k, params.get(k)!));
                close();
                go(keep);
              }}
            >
              Сбросить всё
            </button>
            <button
              type="button"
              className={c.apply}
              onClick={() => {
                close();
                go(draft);
              }}
            >
              {found === null ? 'Показать товары' : found === 0 ? 'Ничего не найдено' : `Показать ${found} ${plural(found, 'товар', 'товара', 'товаров')}`} →
            </button>
          </div>
        </FilterSheet>
      )}
    </>
  );
}

/** Боковая панель фильтров: шапка, прокручиваемые группы и закреплённые кнопки внизу. */
function FilterSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className={c.overlay} onClick={onClose}>
      <aside className={c.sheet} role="dialog" aria-modal="true" aria-label="Фильтры" onClick={(e) => e.stopPropagation()}>
        <div className={c.sheetHead}>
          <div>
            <div className={`eyebrow ${c.sheetEyebrow}`}>Каталог</div>
            <h2>Фильтры</h2>
          </div>
          <button type="button" className={c.close} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/** «Показать ещё»: догружает следующую страницу под текущей; SSR-страницы остаются для поисковиков. */
export function LoadMore({ initial, page, pages }: { initial: Card[]; page: number; pages: number }) {
  const params = useSearchParams();
  const path = usePathname();
  const [items, setItems] = useState(initial);
  const [last, setLast] = useState(page);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setItems(initial);
    setLast(page);
  }, [initial, page]);

  const category = categoryOf(path);
  return (
    <>
      <div className={`${s.grid} ${c.grid}`}>
        {items.map((p, i) => (
          <ProductCard key={p.id} p={p} priority={i < 5} />
        ))}
      </div>
      {last < pages && (
        <div className={c.more}>
          <button
            type="button"
            className={c.moreBtn}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const q = new URLSearchParams(params);
              q.set('page', String(last + 1));
              if (category) q.set('category', category);
              const res = await fetch(`/api/catalog/products?${q}`);
              const data = (await res.json()) as CatalogList;
              setItems((prev) => [...prev, ...data.items.filter((x) => !prev.some((p) => p.id === x.id))]);
              setLast(data.page);
              setBusy(false);
            }}
          >
            {busy ? 'Загружаем…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </>
  );
}
