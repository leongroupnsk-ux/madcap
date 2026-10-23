import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { ButtonLink } from '@/components/ui';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Журнал редакции' };

type Row = { kind: 'article' | 'collection'; id: string; title: string; status: string; products: number; updatedAt: string };
const STATUS: Record<string, string> = { draft: 'Черновик', published: 'Опубликовано', pending: 'На модерации', rejected: 'Отклонено' };

/** Материалы от имени площадки (ТЗ §8: «статьи редакции»): автор — площадка, публикация без модерации */
export default async function EditorialPage() {
  const rows = (await serverApi<Row[]>('/admin/editorial')).data ?? [];
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Журнал редакции</h1>
        </div>
        <div className={s.actions}>
          <ButtonLink href="/admin/editorial/collections/new" variant="outline">
            Новая подборка
          </ButtonLink>
          <ButtonLink href="/admin/editorial/articles/new">Новая статья</ButtonLink>
        </div>
      </div>
      <p className={s.muted} style={{ marginBottom: 12 }}>
        В журнале материалы редакции подписаны названием площадки. К ним можно привязать товары любых поставщиков.
      </p>
      <div className={`${s.panel} ${s.scroll}`} style={{ padding: 0 }}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Материал</th>
              <th>Тип</th>
              <th>Товаров</th>
              <th>Статус</th>
              <th>Изменён</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className={s.link} href={`/admin/editorial/${r.kind === 'article' ? 'articles' : 'collections'}/${r.id}`}>
                    {r.title}
                  </Link>
                </td>
                <td>{r.kind === 'article' ? 'Статья' : 'Подборка'}</td>
                <td>{r.products}</td>
                <td>
                  <Badge status={r.status}>{STATUS[r.status]}</Badge>
                </td>
                <td className={s.muted}>{new Date(r.updatedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className={s.muted} style={{ padding: 24 }}>Материалов редакции пока нет.</p>}
      </div>
    </>
  );
}
