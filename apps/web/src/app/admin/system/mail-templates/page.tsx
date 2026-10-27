import Link from 'next/link';
import s from '@/components/supplier/cabinet.module.css';
import { Alert } from '@/components/ui';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Шаблоны писем' };

type Row = { key: string; group: string; title: string; description: string; customized: boolean; updatedAt: string | null };

/** Реестр писем системы: тема и текст каждого письма правятся владельцем, по умолчанию — текст из кода */
export default async function MailTemplatesPage() {
  const { data } = await serverApi<Row[]>('/admin/system/mail-templates');
  const groups = new Map<string, Row[]>();
  for (const r of data ?? []) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">
            <Link href="/admin/system">Сотрудники и настройки</Link>
          </div>
          <h1>Шаблоны писем</h1>
          <div className={s.muted}>Обычный текст с подстановками вида {'{{order.number}}'}, без HTML. Изменения — в журнале действий.</div>
        </div>
      </div>
      {!data && <Alert tone="error">Не удалось загрузить шаблоны</Alert>}
      <div style={{ display: 'grid', gap: 16 }}>
        {[...groups].map(([group, rows]) => (
          <section key={group} className={s.panel}>
            <h2>{group}</h2>
            <div className={s.scroll}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Письмо</th>
                    <th scope="col">Когда уходит</th>
                    <th scope="col">Текст</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <Link className={s.link} href={`/admin/system/mail-templates/${r.key}`}>
                          {r.title}
                        </Link>
                        <div className={s.muted}>{r.key}</div>
                      </td>
                      <td className={s.muted}>{r.description}</td>
                      <td>
                        <span className={`${s.badge} ${r.customized ? s.b_revision : s.b_draft}`}>{r.customized ? 'изменён' : 'стандартный'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
