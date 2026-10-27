'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Doc = { slug: string; title: string; version: string | null; publishedAt: string | null };

/** Юридические страницы (ТЗ §8 «Витрина», §11): правка без выкладки, каждая публикация — новая версия. */
export default function AdminLegalPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Doc[]>('/admin/legal').then(setDocs).catch((e) => setError(isApiError(e) ? e.message : 'Ошибка'));
  }, []);
  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">Админка</div>
          <h1>Юридические страницы</h1>
        </div>
      </div>
      <p className={s.muted} style={{ marginBottom: 16 }}>
        Пока документ не опубликован здесь, сайт показывает черновик из кода. Версия политики, оферты и согласия на фото записывается вместе с согласием пользователя.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <section className={s.tableCard}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Документ</th>
              <th scope="col">Версия</th>
              <th scope="col" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {docs?.map((d) => (
              <tr key={d.slug}>
                <td>
                  <b>{d.title}</b>
                  <div className={s.muted}>/legal/{d.slug}</div>
                </td>
                <td className={s.muted}>{d.version ?? 'черновик из кода'}</td>
                <td>
                  <Link className={s.link} href={`/admin/legal/${d.slug}`}>
                    Редактировать
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
