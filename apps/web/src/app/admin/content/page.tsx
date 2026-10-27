import Link from 'next/link';
import { Badge } from '@/components/admin/Badge';
import s from '@/components/admin/admin.module.css';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Модерация контента' };

type Item = { kind: 'article' | 'collection'; id: string; title: string; supplier: string; since: string };

export default async function AdminContentPage() {
  const items = (await serverApi<Item[]>('/admin/content')).data ?? [];
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Модерация контента · {items.length}</h1>
        </div>
      </div>
      <div className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Материал</th>
              <th scope="col">Автор</th>
              <th scope="col">Тип</th>
              <th scope="col" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  <b>{i.title}</b>
                </td>
                <td className={s.muted}>{i.supplier}</td>
                <td>
                  <Badge status="pending">{i.kind === 'article' ? 'Статья' : 'Подборка'}</Badge>
                </td>
                <td>
                  <Link className={s.link} href={`/admin/content/${i.kind}/${i.id}`}>
                    Открыть →
                  </Link>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4} className={s.empty}>
                  Очередь пуста.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
