import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { ButtonLink } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';

export const metadata: Metadata = { title: 'Контент' };

type Row = { kind: 'article' | 'collection'; id: string; title: string; status: string; rejectReason: string | null; products: number; blocks: number };
const STATUS: Record<string, string> = { draft: 'Черновик', pending: 'На модерации', published: 'Опубликовано', rejected: 'Отклонено' };

export default async function ContentPage() {
  if (!(await requireSupplier())) return null;
  const rows = (await serverApi<Row[]>('/supplier/content')).data ?? [];
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Материалы поставщика</div>
          <h1>Контент</h1>
          <p className={s.muted} style={{ marginTop: 8 }}>
            Статьи и подборки попадают в журнал и на страницы ваших товаров после модерации.
          </p>
        </div>
        <div className={s.actions}>
          <ButtonLink href="/supplier/content/collections/new" variant="outline">
            Новая подборка
          </ButtonLink>
          <ButtonLink href="/supplier/content/articles/new">Новая статья</ButtonLink>
        </div>
      </div>
      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Материал</th>
              <th>Тип</th>
              <th>Модерация</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.title}</b>
                  {r.rejectReason && r.status === 'rejected' && <div className={s.muted}>Причина: {r.rejectReason}</div>}
                </td>
                <td className={s.muted}>{r.kind === 'article' ? `статья · ${r.blocks} блоков, ${r.products} товаров` : `подборка · ${r.products} товаров`}</td>
                <td>
                  <Badge status={r.status}>{STATUS[r.status]}</Badge>
                </td>
                <td>
                  <Link className={s.link} href={`/supplier/content/${r.kind === 'article' ? 'articles' : 'collections'}/${r.id}`}>
                    Редактировать →
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className={s.muted} style={{ padding: 24 }}>
                  Материалов пока нет. Статья с полезными советами и ссылками на ваши товары — хороший способ попасть в журнал.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
