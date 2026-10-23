'use client';

import { PHOTO_ANGLES } from '@aesculap/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type View = {
  id: string; question: string; sharePhotos: boolean; status: 'open' | 'answered' | 'cancelled'; answer: string | null; createdAt: string; answeredAt: string | null; stylist: string | null;
  profile: {
    name: string | null; gender: string | null; age: number | null; heightCm: number | null; heightRange: string | null; weightKg: number | null;
    sizeTop: string | null; sizeBottom: string | null; sizeShoes: string | null; bodyType: string | null; colorType: string | null; budget: string | null; specialties: string[]; dressCode: string | null;
  } | null;
  capsule: { slot: string; title: string | null; slug: string | null; color: string | null; size: string | null }[];
  photos: { id: string; angle: string | null; url: string }[];
};
const SLOT: Record<string, string> = { top: 'Топ', pants: 'Брюки', gown: 'Халат', shoes: 'Обувь', accessory: 'Аксессуар' };
const STATUS = { open: 'Ждёт ответа', answered: 'Отвечен', cancelled: 'Отменён покупателем' } as const;
const v = (x: string | number | null | undefined, unit = '') => (x == null || x === '' ? '—' : `${x}${unit}`);

/** Вопрос покупателя: анкета, капсула, фото (если разрешены) и ответ стилиста (ТЗ §8, §11) */
export default function AdminStylistRequestPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<View | null>(null);
  const [answer, setAnswer] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    api<View>(`/admin/stylist/${id}`).then(setD).catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
  }, [id]);
  if (!d) return msg ? <Alert tone="error">{msg.text}</Alert> : null;
  const pr = d.profile;

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">
            <Link href="/admin/stylist">Консультации стилиста</Link>
          </div>
          <h1>{pr?.name ?? 'Вопрос покупателя'}</h1>
          <div className={s.muted}>
            {STATUS[d.status]} · {new Date(d.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
          </div>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={s.detail} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <section className={s.panel}>
            <h2>Вопрос</h2>
            <p style={{ whiteSpace: 'pre-line' }}>{d.question}</p>
          </section>
          {d.status === 'open' ? (
            <section className={s.panel}>
              <h2>Ответ</h2>
              <textarea className={s.input} rows={7} style={{ width: '100%', font: 'inherit' }} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={3000} aria-label="Ответ стилиста" />
              <p className={s.muted}>Ответ уйдёт покупателю на почту и появится в профиле. После отправки анкета и фото закроются.</p>
              <Button
                disabled={answer.trim().length < 20}
                onClick={async () => {
                  setMsg(null);
                  try {
                    setD(await api<View>(`/admin/stylist/${id}/answer`, { answer }));
                    setMsg({ tone: 'success', text: 'Ответ отправлен' });
                  } catch (e) {
                    setMsg({ tone: 'error', text: isApiError(e) ? (e.errors ? Object.values(e.errors)[0] : e.message) : 'Нет связи с сервером' });
                  }
                }}
              >
                Отправить ответ
              </Button>
            </section>
          ) : (
            d.answer && (
              <section className={s.panel}>
                <h2>Ответ{d.stylist && ` · ${d.stylist}`}</h2>
                <p style={{ whiteSpace: 'pre-line' }}>{d.answer}</p>
              </section>
            )
          )}
          {d.photos.length > 0 && (
            <section className={s.panel}>
              <h2>Фото</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {d.photos.map((ph) => (
                  <figure key={ph.id} style={{ margin: 0 }}>
                    <img src={ph.url} alt={PHOTO_ANGLES.find((a) => a.id === ph.angle)?.label ?? 'Фото'} style={{ width: '100%', borderRadius: 12, display: 'block' }} />
                    <figcaption className={s.muted}>{PHOTO_ANGLES.find((a) => a.id === ph.angle)?.label ?? ''}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className={s.detailSide}>
          {pr ? (
            <>
              <section className={s.panel}>
                <h2>Анкета</h2>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', margin: 0 }}>
                  <dt className={s.muted}>Пол, возраст</dt>
                  <dd style={{ margin: 0 }}>{pr.gender === 'male' ? 'Мужской' : pr.gender === 'female' ? 'Женский' : '—'}, {v(pr.age)}</dd>
                  <dt className={s.muted}>Рост, вес</dt>
                  <dd style={{ margin: 0 }}>
                    {v(pr.heightCm, ' см')} ({v(pr.heightRange)}), {v(pr.weightKg, ' кг')}
                  </dd>
                  <dt className={s.muted}>Размеры</dt>
                  <dd style={{ margin: 0 }}>
                    верх {v(pr.sizeTop)}, низ {v(pr.sizeBottom)}, обувь {v(pr.sizeShoes)}
                  </dd>
                  <dt className={s.muted}>Фигура</dt>
                  <dd style={{ margin: 0 }}>{v(pr.bodyType)}</dd>
                  <dt className={s.muted}>Цветотип</dt>
                  <dd style={{ margin: 0 }}>{v(pr.colorType)}</dd>
                  <dt className={s.muted}>Специальность</dt>
                  <dd style={{ margin: 0 }}>{pr.specialties.join(', ') || '—'}</dd>
                  <dt className={s.muted}>Бюджет</dt>
                  <dd style={{ margin: 0 }}>{v(pr.budget)}</dd>
                  {pr.dressCode && (
                    <>
                      <dt className={s.muted}>Дресс-код</dt>
                      <dd style={{ margin: 0 }}>{pr.dressCode}</dd>
                    </>
                  )}
                </dl>
                {!d.sharePhotos && <p className={s.muted} style={{ marginTop: 10 }}>Покупатель не стал показывать фото.</p>}
              </section>
              <section className={s.panel} style={{ marginTop: 16 }}>
                <h2>Капсула (вариант 1)</h2>
                {d.capsule.length === 0 && <p className={s.muted}>Капсула пуста.</p>}
                {d.capsule.map((i) => (
                  <div key={i.slot} style={{ marginBottom: 6 }}>
                    <span className={s.muted}>{SLOT[i.slot] ?? i.slot}: </span>
                    {i.slug ? (
                      <a className={s.link} href={`/product/${i.slug}`} target="_blank" rel="noreferrer">
                        {i.title}
                      </a>
                    ) : (
                      '—'
                    )}
                    {i.color && <span className={s.muted}> · {i.color}, {i.size}</span>}
                  </div>
                ))}
              </section>
            </>
          ) : (
            <section className={s.panel}>
              <p className={s.muted}>Вопрос закрыт — анкета и фото покупателя больше недоступны.</p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
