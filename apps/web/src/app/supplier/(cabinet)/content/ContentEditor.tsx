'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/supplier/Badge';
import s from '@/components/supplier/cabinet.module.css';
import { Alert } from '@/components/ui';
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
/** Где работает редактор: кабинет поставщика (модерация) или редакция площадки (публикация сразу) */
export type EditorSpace = { api: string; page: string; editorial?: boolean };
const SUPPLIER_SPACE: EditorSpace = { api: '/supplier/content', page: '/supplier/content' };

export function ContentEditor({ kind, initial, space = SUPPLIER_SPACE }: { kind: Kind; initial?: ContentItem; space?: EditorSpace }) {
  const router = useRouter();
  const isArticle = kind === 'article';
  const path = isArticle ? 'articles' : 'collections';
  const [item, setItem] = useState(initial);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [lead, setLead] = useState(initial?.lead ?? initial?.description ?? '');
  const [cover, setCover] = useState<{ key: string | null; url: string | null }>({ key: initial?.coverKey ?? null, url: initial?.coverUrl ?? null });
  const [selected, setSelected] = useState<string[]>(initial?.productIds ?? []);
  const [products, setProducts] = useState<ProductRow[]>([]);
  // Карточки уже выбранных товаров — чтобы показать порядок, даже если поиск их скрыл
  const [known, setKnown] = useState<Record<string, ProductRow>>({});
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editor.current && initial?.body) editor.current.innerHTML = initial.body;
  }, [initial?.body]);

  const remember = (rows: ProductRow[]) => {
    setProducts(rows);
    setKnown((prev) => ({ ...prev, ...Object.fromEntries(rows.map((p) => [p.id, p])) }));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (space.editorial) {
        // Редакция привязывает любые опубликованные товары
        api<{ id: string; title: string; brand: string; image: string | null }[]>(`/admin/storefront/products?q=${encodeURIComponent(q)}`)
          .then((r) => remember(r.map((p) => ({ id: p.id, title: p.title, sku: p.brand, thumbUrl: p.image, moderationStatus: 'published' }))))
          .catch(() => undefined);
        return;
      }
      api<{ items: ProductRow[] }>(`/supplier/products?q=${encodeURIComponent(q)}`).then((r) => remember(r.items)).catch(() => undefined);
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
    const saved = item ? await api<ContentItem>(`${space.api}/${path}/${item.id}`, payload(), 'PUT') : await api<ContentItem>(`${space.api}/${path}`, payload());
    if (!item) {
      router.replace(`${space.page}/${path}/${saved.id}`);
      return saved;
    }
    setItem(saved);
    if (isArticle && editor.current) editor.current.innerHTML = saved.body ?? '';
    return saved;
  };

  // Кнопки действий — в шапке и под формой, как в макете (.Partner-Content-*)
  const actions = (
    <>
      {isArticle && (
        <a className={`${e.btn} ${e.btnOutline}`} href={item?.status === 'published' ? `/journal/${item.slug}` : '#preview'}>
          Предпросмотр
        </a>
      )}
      <button type="button" className={`${e.btn} ${e.btnOutline}`} disabled={busy} onClick={() =>
          run(async () => {
            await save();
            setMsg({ tone: 'success', text: 'Черновик сохранён' });
          })
        }>
        Сохранить черновик
      </button>
      {space.editorial ? (
        item?.status === 'published' ? (
          <button
            type="button"
            className={`${e.btn} ${e.btnOutline}`}
            disabled={busy}
            onClick={() =>
              run(async () => {
                setItem(await api<ContentItem>(`${space.api}/${kind}/${item.id}/unpublish`, {}));
                setMsg({ tone: 'success', text: 'Снято с публикации' });
              })
            }
          >
            Снять с публикации
          </button>
        ) : (
          <button
            type="button"
            className={e.btn}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const saved = await save();
                setItem(await api<ContentItem>(`${space.api}/${kind}/${saved.id}/publish`, {}));
                setMsg({ tone: 'success', text: 'Опубликовано в журнале' });
              })
            }
          >
            Опубликовать
          </button>
        )
      ) : (
        <button
          type="button"
          className={e.btn}
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
        </button>
      )}
    </>
  );

  const toggle = (p: ProductRow, on: boolean) => {
    setKnown((prev) => ({ ...prev, [p.id]: p }));
    setSelected(on ? [...selected, p.id] : selected.filter((x) => x !== p.id));
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...selected];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSelected(next);
  };

  return (
    <div className={space.editorial ? undefined : e.skin}>
      <Link href={space.page} className={e.back}>
        ← К контенту
      </Link>
      <div className={`${s.head} ${e.head}`}>
        <div>
          <div className="eyebrow">{space.editorial ? 'Журнал редакции' : 'Контент поставщика'}</div>
          <div className={e.titleRow}>
            <h1>{item ? (isArticle ? 'Редактировать статью' : 'Редактировать подборку') : isArticle ? 'Новая статья' : 'Новая подборка'}</h1>
            {item && <Badge status={item.status}>{STATUS[item.status]}</Badge>}
          </div>
        </div>
        <div className={`${s.actions} ${e.actions}`}>{actions}</div>
      </div>

      <div className={e.stack}>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {item?.status === 'rejected' && item.rejectReason && <Alert tone="error">Модерация отклонила материал: {item.rejectReason}</Alert>}
        {item?.status === 'published' && <Alert tone="success">{space.editorial ? 'Опубликовано. Правки видны в журнале сразу после сохранения.' : 'Опубликовано. Правки снова отправят материал на модерацию.'}</Alert>}

        <section className={`${s.panel} ${e.card}`}>
          <label className={e.field}>
            <span>{isArticle ? 'Заголовок статьи' : 'Название подборки'}</span>
            <input className={e.input} value={title} onChange={(ev) => setTitle(ev.target.value)} />
          </label>
          <div className={e.field}>
            <span>Обложка</span>
            <div className={e.coverRow}>
              {cover.url ? <img src={cover.url} alt="" className={e.cover} /> : <span className={e.coverEmpty}>Изображение не добавлено</span>}
              <button type="button" className={`${e.btn} ${e.btnOutline} ${e.btnSm}`} disabled={busy} onClick={() => coverInput.current?.click()}>
                {cover.url ? 'Заменить изображение' : 'Добавить изображение'}
              </button>
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
                    setCover(await api<{ key: string; url: string }>(`${space.api}/image`, form));
                  });
                }}
              />
            </div>
          </div>
          <label className={e.field}>
            <span>{isArticle ? 'Лид (подзаголовок)' : 'Описание'}</span>
            <textarea className={e.input} rows={isArticle ? 2 : 3} value={lead} onChange={(ev) => setLead(ev.target.value)} />
          </label>
          {isArticle && (
            <div className={e.field}>
              <span>Текст статьи</span>
              <div className={e.rte}>
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
                <div id="preview" ref={editor} className={e.editor} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Текст статьи" />
              </div>
            </div>
          )}

          <div className={e.block}>
            <div className="eyebrow">{isArticle ? 'Связанные товары' : 'Товары в подборке'}</div>
            <p className={e.hint}>
              {isArticle ? 'Выберите товары, которые хотите связать со статьёй.' : 'Выберите товары, которые хотите добавить в подборку — минимум 3.'}
              {selected.length > 0 && ` Выбрано: ${selected.length}.`}
            </p>
            <input className={`${e.input} ${e.search}`} placeholder="Поиск по названию или артикулу" value={q} onChange={(ev) => setQ(ev.target.value)} aria-label="Поиск товаров" />
            <div className={e.products}>
              {products.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <label key={p.id} className={`${e.product} ${on ? e.productOn : ''}`}>
                    <input type="checkbox" checked={on} onChange={(ev) => toggle(p, ev.target.checked)} />
                    {p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : <span className={e.noimg} />}
                    <span>{p.title}</span>
                    <small>{p.sku}</small>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Порядок товаров в подборке (кадр .Partner-Content-Pop): позиция сохраняется на сервере */}
          {!isArticle && selected.length > 1 && (
            <div className={e.block}>
              <div className="eyebrow">Порядок в подборке</div>
              <ol className={e.order}>
                {selected.map((id, i) => {
                  const p = known[id];
                  return (
                    <li key={id}>
                      <span className={e.orderN}>{i + 1}</span>
                      {p?.thumbUrl ? <img src={p.thumbUrl} alt="" /> : <span className={e.noimg} />}
                      <span className={e.orderTitle}>{p?.title ?? 'Товар'}</span>
                      <button type="button" className={e.arrow} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">
                        ↑
                      </button>
                      <button type="button" className={e.arrow} disabled={i === selected.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">
                        ↓
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <div className={`${s.actions} ${e.actions} ${e.actionsBottom}`}>{actions}</div>
        </section>
      </div>
    </div>
  );
}
