'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import e from './editor.module.css';

type Kind = 'article' | 'collection';
export type ContentItem = {
  id: string; title: string; lead?: string; description?: string; body?: string; coverKey: string | null; coverUrl: string | null;
  status: 'draft' | 'pending' | 'published' | 'rejected'; rejectReason: string | null; productIds: string[]; slug: string;
};
type ProductRow = { id: string; title: string; sku: string; thumbUrl: string | null; moderationStatus: string };

const TOOLS: [string, string, string?][] = [
  ['Абзац', 'formatBlock', 'p'],
  ['H2', 'formatBlock', 'h2'],
  ['H3', 'formatBlock', 'h3'],
  ['Ж', 'bold'],
  ['К', 'italic'],
  ['• Список', 'insertUnorderedList'],
  ['1. Список', 'insertOrderedList'],
];
const STATUS: Record<string, string> = { draft: 'Черновик', pending: 'На модерации', published: 'Опубликовано', rejected: 'Отклонено' };

/** Редактор статьи или подборки (ТЗ §7.6). HTML дополнительно чистится на сервере. */
export function ContentEditor({ kind, initial }: { kind: Kind; initial?: ContentItem }) {
  const router = useRouter();
  const isArticle = kind === 'article';
  const path = isArticle ? 'articles' : 'collections';
  const [item, setItem] = useState(initial);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [lead, setLead] = useState(initial?.lead ?? initial?.description ?? '');
  const [cover, setCover] = useState<{ key: string | null; url: string | null }>({ key: initial?.coverKey ?? null, url: initial?.coverUrl ?? null });
  const [selected, setSelected] = useState<string[]>(initial?.productIds ?? []);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editor.current && initial?.body) editor.current.innerHTML = initial.body;
  }, [initial?.body]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ items: ProductRow[] }>(`/supplier/products?q=${encodeURIComponent(q)}`).then((r) => setProducts(r.items)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ tone: 'error', text: isApiError(err) ? (err.errors ? Object.values(err.errors)[0] : err.message) : 'Нет связи с сервером' });
    } finally {
      setBusy(false);
    }
  }

  const payload = () =>
    isArticle
      ? { title, lead, coverKey: cover.key, body: editor.current?.innerHTML ?? '', productIds: selected }
      : { title, description: lead, coverKey: cover.key, productIds: selected };

  const save = async () => {
    const saved = item ? await api<ContentItem>(`/supplier/content/${path}/${item.id}`, payload(), 'PUT') : await api<ContentItem>(`/supplier/content/${path}`, payload());
    if (!item) {
      router.replace(`/supplier/content/${path}/${saved.id}`);
      return saved;
    }
    setItem(saved);
    if (isArticle && editor.current) editor.current.innerHTML = saved.body ?? '';
    return saved;
  };

  return (
    <>
      <Link href="/supplier/content" className={s.link}>
        ← К контенту
      </Link>
      <div className={s.head} style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">Контент поставщика</div>
          <h1>{item ? (isArticle ? 'Статья' : 'Подборка') : isArticle ? 'Новая статья' : 'Новая подборка'}</h1>
          {item && (
            <div style={{ marginTop: 8 }}>
              <Badge status={item.status}>{STATUS[item.status]}</Badge>
            </div>
          )}
        </div>
        <div className={s.actions}>
          {isArticle && item && (
            <a className={s.link} style={{ alignSelf: 'center' }} href={item.status === 'published' ? `/journal/${item.slug}` : '#preview'}>
              Предпросмотр
            </a>
          )}
          <Button variant="outline" disabled={busy} onClick={() =>
              run(async () => {
                await save();
                setMsg({ tone: 'success', text: 'Черновик сохранён' });
              })
            }>
            Сохранить черновик
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const saved = await save();
                await api(`/supplier/content/${path}/${saved.id}/submit`, {});
                setItem({ ...saved, status: 'pending' });
                setMsg({ tone: 'success', text: 'Отправлено на модерацию' });
              })
            }
          >
            Отправить на модерацию
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {item?.status === 'rejected' && item.rejectReason && <Alert tone="error">Модерация отклонила материал: {item.rejectReason}</Alert>}
        {item?.status === 'published' && <Alert tone="success">Опубликовано. Правки снова отправят материал на модерацию.</Alert>}

        <section className={s.panel}>
          <label className={e.field}>
            <span>{isArticle ? 'Заголовок статьи' : 'Название подборки'}</span>
            <input className={e.input} value={title} onChange={(ev) => setTitle(ev.target.value)} />
          </label>
          <div className={e.field}>
            <span>Обложка</span>
            <div className={e.coverRow}>
              {cover.url ? <img src={cover.url} alt="" className={e.cover} /> : <span className={e.coverEmpty}>Изображение не добавлено</span>}
              <Button variant="outline" disabled={busy} onClick={() => coverInput.current?.click()}>
                {cover.url ? 'Заменить' : 'Добавить изображение'}
              </Button>
              <input
                ref={coverInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = '';
                  if (!file) return;
                  void run(async () => {
                    const form = new FormData();
                    form.append('file', file);
                    setCover(await api<{ key: string; url: string }>('/supplier/content/image', form));
                  });
                }}
              />
            </div>
          </div>
          <label className={e.field}>
            <span>{isArticle ? 'Лид (подзаголовок)' : 'Описание'}</span>
            <textarea className={e.input} rows={isArticle ? 2 : 4} value={lead} onChange={(ev) => setLead(ev.target.value)} />
          </label>
          {isArticle && (
            <div className={e.field}>
              <span>Текст статьи</span>
              <div className={e.toolbar} role="toolbar" aria-label="Форматирование">
                {TOOLS.map(([label, cmd, arg]) => (
                  <button key={label} type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => document.execCommand(cmd, false, arg)}>
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    const url = prompt('Ссылка (https://…)');
                    if (url && /^https?:\/\//.test(url)) document.execCommand('createLink', false, url);
                  }}
                >
                  Ссылка
                </button>
              </div>
              <div id="preview" ref={editor} className={e.editor} contentEditable suppressContentEditableWarning aria-label="Текст статьи" />
            </div>
          )}
        </section>

        <section className={s.panel}>
          <div className="eyebrow">{isArticle ? 'Связанные товары' : 'Товары в подборке'}</div>
          <p className={s.muted}>
            {isArticle ? 'Выберите товары, которые хотите связать со статьёй.' : 'Выберите товары для подборки — минимум 3.'} Выбрано: {selected.length}
          </p>
          <input className={e.input} placeholder="Поиск по названию или артикулу" value={q} onChange={(ev) => setQ(ev.target.value)} />
          <div className={e.products}>
            {products.map((p) => (
              <label key={p.id} className={e.product}>
                <input type="checkbox" checked={selected.includes(p.id)} onChange={(ev) => setSelected(ev.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
                {p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : <span className={e.noimg} />}
                <span>{p.title}</span>
                <small>{p.sku}</small>
              </label>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
