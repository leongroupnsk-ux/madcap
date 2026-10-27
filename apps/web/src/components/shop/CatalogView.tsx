import Link from 'next/link';
import { Fragment } from 'react';
import type { CatalogList, Chip } from '@/lib/catalog';
import { toQuery } from '@/lib/catalog';
import c from './catalog.module.css';
import { FiltersPanel, LoadMore, SortSelect } from './CatalogControls';
import { ProductGrid } from './ProductCard';

type Props = {
  data: CatalogList;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  title: string;
  crumbs: { href: string; label: string }[];
  chips: Chip[];
};

const FILTER_KEYS = ['gender', 'size', 'color', 'brand', 'specialty', 'height', 'priceFrom', 'priceTo', 'sale', 'fit'];

/** Каталог, раздел и поиск — кадры .Catalog / .Catalog-rope макета: надзаголовок, заголовок, чипы с сортировкой, сетка. */
export function CatalogView({ data, basePath, params, title, crumbs, chips }: Props) {
  const active = FILTER_KEYS.reduce((n, k) => n + (params[k] ? (Array.isArray(params[k]) ? params[k]!.length : 1) : 0), 0);
  const pageHref = (page: number) => {
    const q = toQuery({ ...params, page: page > 1 ? String(page) : undefined });
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <div className={`container ${c.page}`}>
      <nav className={`eyebrow ${c.crumbs}`} aria-label="Хлебные крошки">
        {crumbs.map((b, i) => (
          <Fragment key={b.href}>
            {i > 0 && <span aria-hidden> → </span>}
            <Link href={b.href}>{b.label}</Link>
          </Fragment>
        ))}
      </nav>
      <div className={c.head}>
        <h1>{title}</h1>
        <FiltersPanel facets={data.facets} active={active} personal={!!data.personal} />
      </div>

      <div className={c.toolbar}>
        {chips.length > 0 && (
          <div className={c.chips}>
            {chips.map((ch) => (
              <Link key={ch.href} href={ch.href} className={`${c.chip} ${ch.active ? c.chipOn : ''}`} aria-current={ch.active ? 'page' : undefined}>
                {ch.label}
              </Link>
            ))}
          </div>
        )}
        <SortSelect />
      </div>

      {data.items.length === 0 ? (
        <div className={c.empty}>
          {data.didYouMean ? (
            <p>
              Ничего не нашли. Возможно, вы искали{' '}
              <Link href={`${basePath}?${toQuery({ ...params, q: data.didYouMean, page: undefined }).toString()}`} className={c.didYouMean}>
                «{data.didYouMean}»
              </Link>
              ?
            </p>
          ) : (
            <p>Ничего не нашли. Попробуйте убрать часть фильтров.</p>
          )}
          <Link href={basePath} className={c.chip}>
            Сбросить фильтры
          </Link>
        </div>
      ) : (
        <>
          <LoadMore initial={data.items} page={data.page} pages={data.pages} />
          {data.pages > 1 && (
            <nav className={c.pager} aria-label="Страницы">
              {Array.from({ length: data.pages }, (_, i) => i + 1).map((p) =>
                p === data.page ? (
                  <span key={p} aria-current="page">
                    {p}
                  </span>
                ) : (
                  <Link key={p} href={pageHref(p)} rel={p === data.page + 1 ? 'next' : p === data.page - 1 ? 'prev' : undefined}>
                    {p}
                  </Link>
                ),
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export { ProductGrid };
