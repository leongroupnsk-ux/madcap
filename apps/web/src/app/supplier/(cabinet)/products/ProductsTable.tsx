'use client';

import { formatRub } from '@aesculap/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button, ButtonLink } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Row = {
  id: string; title: string; brand: string; sku: string; thumbUrl: string | null; priceFrom: number | null; sizes: string;
  stock: number; moderationStatus: string; hasPendingRevision: boolean; source: 'manual' | 'file' | 'yml';
};
type ListResponse = { total: number; page: number; pages: number; items: Row[] };

const SOURCE = { manual: 'Вручную', file: 'Файл', yml: 'YML-фид' } as const;
const STATUSES = [
  ['', 'Все'], ['published', 'Опубликованы'], ['pending', 'На модерации'], ['revision', 'Правки на модерации'],
  ['draft', 'Черновики'], ['rejected', 'Отклонены'], ['hidden', 'Сняты с витрины'], ['out_of_stock', 'Нет в наличии'],
] as const;

export function ProductsTable() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(params.get('q') ?? '');

  const load = useCallback(() => {
    api<ListResponse>(`/supplier/products?${params.toString()}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(isApiError(e) ? e.message : 'Не удалось загрузить товары'));
  }, [params]);
  useEffect(load, [load]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.replace(`${path}?${next}`);
  };

  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get('q') ?? '') ? setParam('q', q) : undefined), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Каталог поставщика</div>
          <h1>Товары{data ? ` · ${data.total}` : ''}</h1>
        </div>
        <div className={s.actions}>
          <a href="/api/supplier/products/export.csv" className={s.link}>
            Экспорт CSV
          </a>
          <ButtonLink href="/supplier/products/new">Добавить товар</ButtonLink>
        </div>
      </div>

      <div className={s.filters}>
        <input className={s.input} style={{ flex: '0 1 290px', minWidth: 0 }} placeholder="Поиск по названию или артикулу" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
        <select className={s.input} value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)} aria-label="Статус">
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className={s.input} value={params.get('sort') ?? ''} onChange={(e) => setParam('sort', e.target.value)} aria-label="Сортировка">
          <option value="">Недавно изменённые</option>
          <option value="created">Новые</option>
          <option value="title">По названию</option>
        </select>
        {selected.size > 0 && (
          <Button
            variant="outline"
            onClick={async () => {
              const res = await api<{ hidden: number }>('/supplier/products/bulk-hide', { ids: [...selected] });
              setSelected(new Set());
              alert(`Снято с витрины: ${res.hidden}`);
              load();
            }}
          >
            Снять с витрины ({selected.size})
          </Button>
        )}
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      <div className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th style={{ width: 36, paddingRight: 0 }} aria-label="Выбор" />
              <th>Товар</th>
              <th>Артикул</th>
              <th>Цена</th>
              <th>Размеры</th>
              <th>Остаток</th>
              <th>Модерация</th>
              <th>Источник</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id}>
                <td style={{ paddingRight: 0 }}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Выбрать ${p.title}`} />
                </td>
                <td>
                  <Link href={`/supplier/products/${p.id}`} className={s.productCell}>
                    {p.thumbUrl ? <img src={p.thumbUrl} alt="" className={s.thumb} /> : <span className={s.thumb} />}
                    <span>
                      <b>{p.title}</b>
                      <small>{p.brand}</small>
                    </span>
                  </Link>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{p.sku}</td>
                <td style={{ whiteSpace: "nowrap" }}>{p.priceFrom == null ? "—" : formatRub(p.priceFrom)}</td>
                <td>{p.sizes || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{p.stock === 0 ? 'Нет в наличии' : `${p.stock} шт.`}</td>
                <td>
                  {p.moderationStatus === 'published' && p.stock === 0 ? <Badge status="hidden">Скрыт · нет остатка</Badge> : <Badge status={p.moderationStatus} />}
                  {p.hasPendingRevision && (
                    <div style={{ marginTop: 4 }}>
                      <Badge status="revision" />
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{SOURCE[p.source]}</td>
                <td>
                  <Link href={`/supplier/products/${p.id}`} className={s.link}>
                    Изменить
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: 'center' }} className={s.muted}>
                  Товаров не найдено. <Link href="/supplier/products/new" className={s.link}>Добавьте вручную</Link> или{' '}
                  <Link href="/supplier/import" className={s.link}>загрузите каталог</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.pages > 1 && (
        <div className={s.filters} style={{ marginTop: 16, alignItems: 'center' }}>
          <Button variant="outline" disabled={data.page <= 1} onClick={() => setParam('page', String(data.page - 1))}>
            ← Назад
          </Button>
          <span className={s.muted}>
            Страница {data.page} из {data.pages}
          </span>
          <Button variant="outline" disabled={data.page >= data.pages} onClick={() => setParam('page', String(data.page + 1))}>
            Вперёд →
          </Button>
        </div>
      )}
    </>
  );
}
