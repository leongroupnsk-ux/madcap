'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Drawer } from '@/components/ui';
import type { Card, CatalogList, Facets } from '@/lib/catalog';
import c from './catalog.module.css';
import { ProductCard } from './ProductCard';
import s from './shop.module.css';

const GENDER = { female: 'Женский', male: 'Мужской', unisex: 'Унисекс' } as const;

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

/** Панель «Фильтры» (ТЗ §4.4): выбор копится локально и применяется кнопкой — фильтры попадают в URL. */
export function FiltersPanel({ facets, active }: { facets: Facets; active: number }) {
  const { params, go } = useParamsNav();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new URLSearchParams(params));
  useEffect(() => setDraft(new URLSearchParams(params)), [params]);

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
  const Opt = ({ k, v, label, count, swatch }: { k: string; v: string; label: string; count?: number; swatch?: string }) => (
    <button type="button" className={`${c.opt} ${has(k, v) ? c.optOn : ''}`} onClick={() => toggle(k, v)} aria-pressed={has(k, v)}>
      {swatch && <span className={c.swatch} style={{ background: swatch }} />}
      {label}
      {count !== undefined && <small>{count}</small>}
    </button>
  );

  return (
    <>
      <button type="button" className={c.filterBtn} onClick={() => setOpen(true)}>
        Фильтры{active > 0 && <span className={c.count}>{active}</span>}
      </button>
      {open && (
        <Drawer eyebrow="Каталог" title="Фильтры" onClose={() => setOpen(false)}>
          {facets.genders.length > 0 && (
            <div className={c.group}>
              <h3>Пол</h3>
              <div className={c.opts}>
                {facets.genders.map((g) => (
                  <Opt key={g.value} k="gender" v={g.value} label={GENDER[g.value]} count={g.count} />
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
              <div className={c.opts}>
                {facets.colors.map((f) => (
                  <Opt key={f.id} k="color" v={f.id} label={f.name} swatch={f.hex} />
                ))}
              </div>
            </div>
          )}
          <div className={c.group}>
            <h3>Цена, ₽</h3>
            <div className={c.range}>
              <label>
                от
                <input inputMode="numeric" placeholder={String(Math.floor(facets.price.min / 100))} value={draft.get('priceFrom') ?? ''} onChange={(e) => setOne('priceFrom', e.target.value.replace(/\D/g, ''))} />
              </label>
              <label>
                до
                <input inputMode="numeric" placeholder={String(Math.ceil(facets.price.max / 100))} value={draft.get('priceTo') ?? ''} onChange={(e) => setOne('priceTo', e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <div className={c.opts} style={{ marginTop: 12 }}>
              <Opt k="sale" v="1" label="Только со скидкой" />
            </div>
          </div>
          {facets.specialties.length > 0 && (
            <div className={c.group}>
              <h3>Специальность</h3>
              <div className={c.opts}>
                {facets.specialties.map((f) => (
                  <Opt key={f.id} k="specialty" v={f.id} label={f.name} count={f.count} />
                ))}
              </div>
            </div>
          )}
          {facets.brands.length > 0 && (
            <div className={c.group}>
              <h3>Бренд</h3>
              <div className={c.opts}>
                {facets.brands.map((f) => (
                  <Opt key={f.slug} k="brand" v={f.slug} label={f.name} count={f.count} />
                ))}
              </div>
            </div>
          )}
          <div className={c.drawerActions}>
            <Button
              variant="outline"
              onClick={() => {
                const keep = new URLSearchParams();
                ['q', 'sort'].forEach((k) => params.get(k) && keep.set(k, params.get(k)!));
                setOpen(false);
                go(keep);
              }}
            >
              Сбросить
            </Button>
            <Button
              block
              onClick={() => {
                setOpen(false);
                go(draft);
              }}
            >
              Показать товары
            </Button>
          </div>
        </Drawer>
      )}
    </>
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

  const category = path.startsWith('/catalog/') ? path.split('/')[2] : undefined;
  return (
    <>
      <div className={s.grid}>
        {items.map((p, i) => (
          <ProductCard key={p.id} p={p} priority={i < 5} />
        ))}
      </div>
      {last < pages && (
        <div className={c.more}>
          <Button
            variant="outline"
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
          </Button>
        </div>
      )}
    </>
  );
}
