'use client';

import { LEGAL_DOCS, OPERATOR_TOKENS, type LegalSlug } from '@aesculap/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import e from '@/app/supplier/(cabinet)/content/editor.module.css';
import s from '@/components/admin/admin.module.css';
import { Alert, Button, Field } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type Version = { version: number; label: string; title: string; html: string; note: string; publishedAt: string; by: string };

const TOOLS: [string, string, string?][] = [
  ['Абзац', 'formatBlock', 'p'],
  ['H2', 'formatBlock', 'h2'],
  ['H3', 'formatBlock', 'h3'],
  ['Ж', 'bold'],
  ['К', 'italic'],
  ['• Список', 'insertUnorderedList'],
  ['1. Список', 'insertOrderedList'],
];

/** Текст черновика из кода — с публичной страницы, реквизиты оператора как метки [OPERATOR_…] */
async function codeDraft(slug: string): Promise<string> {
  const html = await fetch(`/legal/${slug}`, { cache: 'no-store' }).then((r) => r.text());
  const body = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-legal-body]');
  if (!body) return '';
  body.querySelectorAll('mark').forEach((m) => m.replaceWith(m.textContent ?? ''));
  return body.innerHTML;
}

/** Редактор юридического документа с историей версий (ТЗ §8, §11). HTML чистится на сервере. */
export default function AdminLegalDocPage() {
  const { slug } = useParams<{ slug: LegalSlug }>();
  const editor = useRef<HTMLDivElement>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [viewing, setViewing] = useState<Version | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const h = await api<Version[]>(`/admin/legal/${slug}`);
        setVersions(h);
        setTitle(h[0]?.title ?? LEGAL_DOCS[slug]);
        const html = h[0]?.html ?? (await codeDraft(slug));
        if (editor.current) editor.current.innerHTML = html;
      } catch (err) {
        setMsg({ tone: 'error', text: isApiError(err) ? err.message : 'Ошибка' });
      }
    })();
  }, [slug]);

  const publish = async () => {
    setMsg(null);
    if (!confirm('Опубликовать новую версию? Она сразу появится на сайте, новые согласия будут записаны с ней.')) return;
    try {
      const h = await api<Version[]>(`/admin/legal/${slug}`, { title, html: editor.current?.innerHTML ?? '', note });
      setVersions(h);
      setNote('');
      setMsg({ tone: 'success', text: `Опубликована версия ${h[0].label}` });
    } catch (err) {
      setMsg({ tone: 'error', text: isApiError(err) ? (err.errors ? Object.values(err.errors)[0] : err.message) : 'Нет связи с сервером' });
    }
  };

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">
            <Link href="/admin/legal">Юридические страницы</Link>
          </div>
          <h1>{LEGAL_DOCS[slug] ?? 'Документ'}</h1>
        </div>
        <div className={s.actions}>
          <a className={s.link} href={`/legal/${slug}`} target="_blank" rel="noreferrer" style={{ alignSelf: 'center' }}>
            Открыть на сайте ↗
          </a>
          <Button onClick={publish}>Опубликовать версию</Button>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={s.detail} style={{ marginTop: 16 }}>
        <section className={s.panel} style={{ minWidth: 0 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Заголовок" value={title} onChange={(ev) => setTitle(ev.target.value)} />
            <div className={e.field}>
              <span>Текст</span>
              <div className={e.toolbar} role="toolbar" aria-label="Форматирование">
                {TOOLS.map(([label, cmd, arg]) => (
                  <button key={label} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => document.execCommand(cmd, false, arg)}>
                    {label}
                  </button>
                ))}
              </div>
              <div ref={editor} className={e.editor} contentEditable suppressContentEditableWarning aria-label="Текст документа" />
            </div>
            <p className={s.muted}>Реквизиты оператора подставляются из настроек сервера: {OPERATOR_TOKENS.map((t) => `[${t}]`).join(', ')}.</p>
            <Field label="Что изменилось (для истории)" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Правки юриста по разделу 4" />
          </div>
        </section>
        <div className={s.detailSide}>
          <section className={s.panel}>
            <h2>Версии</h2>
            {versions && versions.length === 0 && <p className={s.muted}>Не публиковался — на сайте черновик из кода.</p>}
            <div style={{ display: 'grid', gap: 10 }}>
              {versions?.map((v) => (
                <div key={v.version}>
                  <b>{v.label}</b>
                  <div className={s.muted}>
                    {new Date(v.publishedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · {v.by}
                    {v.note && ` · ${v.note}`}
                  </div>
                  <button className={s.link} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} onClick={() => setViewing(viewing?.version === v.version ? null : v)}>
                    {viewing?.version === v.version ? 'Скрыть' : 'Посмотреть'}
                  </button>
                  {v.version !== versions[0].version && (
                    <button
                      className={s.link}
                      style={{ border: 0, background: 'none', padding: 0, marginLeft: 12, cursor: 'pointer' }}
                      onClick={() => {
                        if (editor.current) editor.current.innerHTML = v.html;
                        setTitle(v.title);
                        setNote(`Возврат к ${v.label}`);
                      }}
                    >
                      Взять в редактор
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          {viewing && (
            <section className={s.panel} style={{ marginTop: 16, maxHeight: 480, overflow: 'auto' }}>
              <h2>{viewing.label}</h2>
              <div className={e.editor} dangerouslySetInnerHTML={{ __html: viewing.html }} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
