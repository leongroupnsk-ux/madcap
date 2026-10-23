import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LEGAL, operator } from '@/lib/legal';
import s from './legal.module.css';

type P = Promise<{ doc: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const doc = LEGAL[(await params).doc];
  return { title: doc?.title ?? 'Документ' };
}

export const dynamic = 'force-dynamic';

export default async function LegalPage({ params }: { params: P }) {
  const { doc } = await params;
  const d = LEGAL[doc];
  if (!d) notFound();
  const o = operator();
  return (
    <article className={`container ${s.doc}`}>
      {!o.complete && (
        <div className={s.draft} role="note">
          Черновик: реквизиты оператора не заполнены, текст проверяется юристом перед запуском.
        </div>
      )}
      <h1>{d.title}</h1>
      <p className={s.updated}>Редакция от {d.updated}</p>
      {d.body(o)}
    </article>
  );
}
