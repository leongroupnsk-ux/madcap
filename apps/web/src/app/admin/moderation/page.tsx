import Link from 'next/link';
import s from '@/components/admin/admin.module.css';
import { Badge } from '@/components/admin/Badge';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Модерация' };

type Item = { kind: 'product' | 'revision'; id: string; productId: string; title: string; supplier: string; since: string };

export default async function ModerationPage() {
  const items = (await serverApi<Item[]>('/admin/moderation')).data ?? [];
  const now = Date.now();
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Модерация · {items.length}</h1>
        </div>
      </div>
      <div className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Товар</th>
              <th scope="col">Поставщик</th>
              <th scope="col">Тип</th>
              <th scope="col">Ждёт</th>
              <th scope="col" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const hours = Math.floor((now - new Date(i.since).getTime()) / 3_600_000);
              return (
                <tr key={`${i.kind}-${i.id}`}>
                  <td>
                    <b>{i.title}</b>
                  </td>
                  <td className={s.muted}>{i.supplier}</td>
                  <td>{i.kind === 'product' ? <Badge status="pending">Новый товар</Badge> : <Badge status="revision">Правки</Badge>}</td>
                  <td style={{ color: hours >= 24 ? 'var(--c-sale)' : undefined }}>{hours < 1 ? 'меньше часа' : `${hours} ч`}</td>
                  <td>
                    <Link className={s.link} href={`/admin/moderation/${i.productId}`}>
                      Открыть →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!items.length && (
              <tr>
                <td colSpan={5} className={s.empty}>
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
