'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import s from '@/components/admin/admin.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import type { Media } from '@/lib/types';

type Version = { title: string; brand: string; category: string; gender: string; fabric: string; treatment: string; washing: string; description: string; premium?: boolean; specialties: string[]; media: Media[] };
export type Details = {
  id: string; status: string; supplier: { legalName: string; inn: string };
  live: Version; revision: (Version & { id: string; createdAt: string; removedMedia: Media[] }) | null;
  variants: { sku: string; size: string; heightRange: string | null; color: string; price: number; oldPrice: number | null; stock: number }[];
};

const FIELDS: [keyof Version, string][] = [
  ['title', 'Название'], ['brand', 'Бренд'], ['category', 'Категория'], ['gender', 'Пол'], ['fabric', 'Состав'],
  ['treatment', 'Обработка'], ['washing', 'Стирка'], ['description', 'Описание'], ['premium', 'Премиум-коллекция'],
];
const GENDER: Record<string, string> = { female: 'Женский', male: 'Мужской', unisex: 'Унисекс' };

export function Review({ d }: { d: Details }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const isRevision = Boolean(d.revision);
  const proposed = d.revision ?? d.live;
  const base = isRevision ? `/admin/moderation/revisions/${d.revision!.id}` : `/admin/moderation/products/${d.id}`;

  const decide = async (approve: boolean) => {
    setError(null);
    try {
      if (approve) await api(`${base}/approve`, {});
      else {
        const reason = prompt('Причина отказа — её увидит поставщик');
        if (!reason) return;
        await api(`${base}/reject`, { reason });
      }
      router.replace('/admin/moderation');
      router.refresh();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Ошибка');
    }
  };

  const val = (v: Version, k: keyof Version) => (k === 'gender' ? GENDER[v.gender] : k === 'premium' ? (v.premium ? 'Да' : 'Нет') : (v[k] as string)) || '—';

  return (
    <>
      <Link href="/admin/moderation" className={s.link}>
        ← К очереди
      </Link>
      <div className={s.head} style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">
            {d.supplier.legalName} · ИНН {d.supplier.inn}
          </div>
          <h1>{isRevision ? 'Правки опубликованного товара' : 'Новый товар'}</h1>
        </div>
        <div className={s.actions}>
          <Button variant="outline" onClick={() => decide(false)}>
            Отклонить
          </Button>
          <Button onClick={() => decide(true)}>{isRevision ? 'Опубликовать правки' : 'Опубликовать'}</Button>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <section className={s.panel}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Поле</th>
              {isRevision && <th scope="col">На витрине</th>}
              <th scope="col">{isRevision ? 'Предлагается' : 'Значение'}</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(([k, label]) => {
              const changed = isRevision && val(d.live, k) !== val(proposed, k);
              return (
                <tr key={k} style={changed ? { background: '#f9eeda' } : undefined}>
                  <td className={s.muted}>{label}</td>
                  {isRevision && <td>{val(d.live, k)}</td>}
                  <td>{val(proposed, k)}</td>
                </tr>
              );
            })}
            <tr>
              <td className={s.muted}>Специальности</td>
              {isRevision && <td>{d.live.specialties.join(', ') || '—'}</td>}
              <td>{proposed.specialties.join(', ') || '—'}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className={s.panel} style={{ marginTop: 16 }}>
        <h2>Медиа</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {proposed.media.map((m) => (
            <a key={m.id} href={m.url} target="_blank" rel="noreferrer" style={{ position: 'relative' }}>
              <img src={m.thumbUrl ?? m.posterUrl ?? ''} alt="" style={{ width: 120, height: 160, objectFit: 'cover', borderRadius: 8, outline: m.approved ? undefined : '3px solid var(--c-accent)' }} />
              {m.type === 'video' && <span style={{ position: 'absolute', left: 6, bottom: 6, background: '#fff', borderRadius: 6, padding: '2px 6px', fontSize: 11 }}>▶ видео</span>}
              {m.isMain && <span style={{ position: 'absolute', left: 6, top: 6, background: '#fff', borderRadius: 6, padding: '2px 6px', fontSize: 11 }}>главное</span>}
            </a>
          ))}
        </div>
        {d.revision && d.revision.removedMedia.length > 0 && <p className={s.muted}>Будут удалены: {d.revision.removedMedia.length} шт.</p>}
        <p className={s.muted}>Оранжевая рамка — новые файлы, ещё не проверенные.</p>
      </section>

      <section className={s.panel} style={{ marginTop: 16 }}>
        <h2>Варианты · {d.variants.length}</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Размер</th>
              <th scope="col">Цвет</th>
              <th scope="col">Цена</th>
              <th scope="col">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {d.variants.map((v) => (
              <tr key={v.sku}>
                <td>{v.sku}</td>
                <td>
                  {v.size} {v.heightRange && `· ${v.heightRange}`}
                </td>
                <td>{v.color}</td>
                <td>
                  {v.price.toLocaleString('ru-RU')} ₽ {v.oldPrice && <s className={s.muted}>{v.oldPrice.toLocaleString('ru-RU')} ₽</s>}
                </td>
                <td>{v.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
