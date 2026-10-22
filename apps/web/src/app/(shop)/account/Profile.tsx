'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { writeCart } from '@/lib/cart';
import o from '@/components/shop/order.module.css';
import { orderLabel } from './orders/[number]/OrderView';
import p from './profile.module.css';

export type ProfileData = {
  gender: string | null; name: string | null; age: number | null; heightCm: number | null; weightKg: number | null;
  sizeTop: string | null; sizeBottom: string | null; sizeShoes: string | null; hair: string | null; skinTone: string | null;
  colorTypeLabel: string | null; bodyType: string | null; specialtyIds: string[]; budgetLabel: string | null;
  completenessPct: number; quizCompleted: boolean; photos: { id: string; url: string }[];
};

const dash = (...v: (string | number | null | undefined)[]) => v.filter((x) => x != null && x !== '').join(' · ') || '—';

export type OrderRow = { number: string; createdAt: string; status: string; total: number; shipments: number; delivery: string; shipmentStatuses: string[] };

/** Профиль покупателя (ТЗ §6.5). */
export function Profile(props: { email: string; emailVerified: boolean; welcome: boolean; profile: ProfileData; specialties: string[]; consents: Record<string, boolean>; capsule: { count: number; total: number } | null; orders: OrderRow[] }) {
  const router = useRouter();
  const [profile, setProfile] = useState(props.profile);
  const [consents, setConsents] = useState(props.consents);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pr = profile;

  const consent = async (type: string, granted: boolean) => {
    setError(null);
    if (type === 'photos' && !granted && pr.photos.length && !confirm('Отозвать согласие? Все ваши фото будут удалены.')) return;
    try {
      setConsents(await api('/me/consents', { type, granted }));
      if (type === 'photos' && !granted) setProfile({ ...pr, photos: [] });
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Ошибка');
    }
  };

  return (
    <section className="container" style={{ padding: '40px var(--gutter)' }}>
      <div className="eyebrow">Мой профиль</div>
      <h1 className={p.title}>Добрый день{pr.name ? `, ${pr.name}` : ''}.</h1>
      {props.welcome && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="success">Аккаунт создан. Мы отправили письмо для подтверждения email.</Alert>
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className={p.grid}>
        <div className={p.col}>
          <div className={p.dark}>
            <div className={p.muted}>Анкета заполнена на {pr.completenessPct}%</div>
            <div className={p.bar}>
              <span style={{ width: `${pr.completenessPct}%` }} />
            </div>
            <dl className={p.rows}>
              <dt>Пол · рост · вес</dt>
              <dd>{dash(pr.gender === 'female' ? 'Женский' : pr.gender === 'male' ? 'Мужской' : null, pr.heightCm && `${pr.heightCm} см`, pr.weightKg && `${pr.weightKg} кг`)}</dd>
              <dt>Размеры</dt>
              <dd>{dash(pr.sizeTop && `Верх: ${pr.sizeTop}`, pr.sizeBottom && `Низ: ${pr.sizeBottom}`, pr.sizeShoes && `Обувь: ${pr.sizeShoes}`)}</dd>
              <dt>Тип фигуры</dt>
              <dd>{pr.bodyType ?? '—'}</dd>
              <dt>Цветотип</dt>
              <dd>{pr.colorTypeLabel ?? '—'}</dd>
              <dt>Специальность</dt>
              <dd>{props.specialties.join(', ') || '—'}</dd>
              <dt>Бюджет</dt>
              <dd>{pr.budgetLabel ?? '—'}</dd>
            </dl>
            <Link href="/quiz/1" className={p.accentLink}>
              {pr.quizCompleted ? 'Редактировать анкету →' : 'Пройти анкету →'}
            </Link>
          </div>
          <div className={p.soft}>
            <div className="eyebrow">Моя капсула</div>
            {props.capsule ? (
              <>
                <div className={p.big}>
                  {props.capsule.count} {plural(props.capsule.count, 'вещь', 'вещи', 'вещей')} · {formatRub(props.capsule.total)}
                </div>
                <Link href="/capsule" className={p.link}>
                  Посмотреть капсулу →
                </Link>
              </>
            ) : (
              <p className={p.muted}>Капсула появится после анкеты.</p>
            )}
          </div>
        </div>

        <div className={p.col}>
          <div className={p.card}>
            <h2>Фото</h2>
            {consents.photos ? (
              <>
                <div className={p.photos}>
                  {pr.photos.map((ph) => (
                    <div key={ph.id} className={p.photo}>
                      <img src={ph.url} alt="" />
                      <button
                        aria-label="Удалить фото"
                        onClick={async () => setProfile(await api<ProfileData>(`/me/photos/${ph.id}`, undefined, 'DELETE'))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {pr.photos.length < 4 && (
                    <button className={p.addPhoto} onClick={() => input.current?.click()}>
                      + Фото
                    </button>
                  )}
                </div>
                <input
                  ref={input}
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/webp"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const form = new FormData();
                    form.append('file', file);
                    try {
                      setProfile(await api<ProfileData>('/me/photos', form));
                    } catch (err) {
                      setError(isApiError(err) ? err.message : 'Не удалось загрузить фото');
                    }
                  }}
                />
                <p className={p.muted}>Ваши фото видите только вы; они нужны для формирования индивидуальной капсулы.</p>
              </>
            ) : (
              <p className={p.muted}>Чтобы добавить фото, дайте согласие на их хранение ниже.</p>
            )}
          </div>
          <div className={p.card}>
            <div className={p.accountHead}>
              <h2>Аккаунт</h2>
              <Link href="/reset-password" className={p.sale}>
                сменить пароль
              </Link>
            </div>
            <p style={{ margin: '0 0 12px' }}>
              {props.email}
              {!props.emailVerified && (
                <button
                  className={p.inline}
                  disabled={resent}
                  onClick={async () => {
                    await api('/auth/resend-verification', {});
                    setResent(true);
                  }}
                >
                  {resent ? 'письмо отправлено' : 'подтвердить email'}
                </button>
              )}
            </p>
            {(
              [
                ['pdn', 'Я согласен с политикой персональных данных'],
                ['offer', 'Я согласен с офертой'],
                ['photos', 'Я согласен с хранением моих фото'],
                ['marketing', 'Хочу получать новости и подборки'],
              ] as const
            ).map(([type, label]) => (
              <label key={type} className={p.consent}>
                <input type="checkbox" checked={Boolean(consents[type])} onChange={(e) => consent(type, e.target.checked)} />
                {label}
              </label>
            ))}
            <div style={{ marginTop: 16 }}>
              <Button
                variant="outline"
                onClick={async () => {
                  await api('/auth/logout', {});
                  writeCart([]);
                  localStorage.removeItem('cart-owner');
                  router.replace('/');
                  router.refresh();
                }}
              >
                Выйти
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="eyebrow" style={{ marginTop: 32 }}>
        История заказов
      </div>
      {props.orders.length === 0 ? (
        <p className={p.muted}>Заказов пока нет.</p>
      ) : (
        <div className={o.history} style={{ marginTop: 12 }}>
          {props.orders.map((r) => (
            <Link key={r.number} href={`/account/orders/${r.number}`} className={o.historyRow}>
              <span>
                <b>№ {r.number}</b> · {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                <span className={o.muted} style={{ display: 'block' }}>
                  {r.shipments} {plural(r.shipments, 'отправление', 'отправления', 'отправлений')} · {formatRub(r.total)} · {r.delivery}
                </span>
              </span>
              <span className={r.status === 'cancelled' ? o.statusBad : r.status === 'pending_payment' ? o.statusWarn : o.status}>
                {orderLabel({ status: r.status, shipments: r.shipmentStatuses.map((st) => ({ status: st })) })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
