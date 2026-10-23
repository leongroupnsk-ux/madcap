import { OPERATOR_TOKENS } from '@aesculap/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LEGAL, operator } from '@/lib/legal';
import { serverApi } from '@/lib/server-api';
import s from './legal.module.css';

type P = Promise<{ doc: string }>;
type Published = { title: string; html: string; version: string; publishedAt: string };

/** Опубликованная из админки версия; если её нет — черновик из кода */
const published = async (doc: string) => (Object.hasOwn(LEGAL, doc) ? (await serverApi<Published>(`/legal/${doc}`)).data : null);

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Реквизиты оператора в тексте ([OPERATOR_NAME] и т. п.) — из окружения сервера */
function withOperator(html: string, o: ReturnType<typeof operator>) {
  const values: Record<string, string | null> = { OPERATOR_NAME: o.name, OPERATOR_INN: o.inn, OPERATOR_OGRN: o.ogrn, OPERATOR_ADDRESS: o.address, OPERATOR_EMAIL: o.email };
  return OPERATOR_TOKENS.reduce((h, k) => h.replaceAll(`[${k}]`, values[k] ? esc(values[k]) : `<mark title="Задайте ${k}">[${k}]</mark>`), html);
}

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const { doc } = await params;
  return { title: (await published(doc))?.title ?? (Object.hasOwn(LEGAL, doc) ? LEGAL[doc].title : null) ?? 'Документ' };
}

export const dynamic = 'force-dynamic';

export default async function LegalPage({ params }: { params: P }) {
  const { doc } = await params;
  const d = Object.hasOwn(LEGAL, doc) ? LEGAL[doc] : undefined;
  if (!d) notFound();
  const o = operator();
  const pub = await published(doc);
  return (
    <article className={`container ${s.doc}`}>
      {!o.complete && (
        <div className={s.draft} role="note">
          Черновик: реквизиты оператора не заполнены, текст проверяется юристом перед запуском.
        </div>
      )}
      <h1>{pub?.title ?? d.title}</h1>
      <p className={s.updated}>
        Редакция от {pub ? new Date(pub.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : d.updated}
        {pub && ` · версия ${pub.version}`}
      </p>
      {/* HTML очищен по белому списку на сервере при публикации */}
      {pub ? <div data-legal-body dangerouslySetInnerHTML={{ __html: withOperator(pub.html, o) }} /> : <div data-legal-body>{d.body(o)}</div>}
    </article>
  );
}
