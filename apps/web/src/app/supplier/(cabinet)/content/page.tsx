import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
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
        </div>
        <div className={`${s.actions} ${s.actionsTight}`}>
          <Link href="/supplier/content/collections/new" className={`${s.pillBtn} ${s.pillGrey}`}>
            Новая подборка
          </Link>
          <Link href="/supplier/content/articles/new" className={s.pillBtn}>
            Новая статья
          </Link>
        </div>
      </div>
      <p className={`${s.lead} ${s.leadTop}`}>Статьи и подборки попадают в журнал и на страницы ваших товаров после модерации.</p>
      <div className={s.tableCard}>
        <table className={`${s.table} ${s.tableCompact}`}>
          <colgroup>
            <col style={{ width: '40%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Материал</th>
              <th>Тип</th>
              <th>Модерация</th>
              <th aria-label="Действие" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={s.strong}>
                  {r.title}
                  {r.rejectReason && r.status === 'rejected' && <div className={s.sub}>Причина: {r.rejectReason}</div>}
                </td>
                <td>{r.kind === 'article' ? (r.status === 'draft' && !r.blocks ? 'статья · черновик' : `статья · ${r.blocks} ${plural(r.blocks, 'блок', 'блока', 'блоков')}, ${r.products} ${plural(r.products, 'товар', 'товара', 'товаров')}`) : `подборка · ${r.products} ${plural(r.products, 'товар', 'товара', 'товаров')}`}</td>
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

/** Склонение: 1 блок, 2 блока, 5 блоков */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
