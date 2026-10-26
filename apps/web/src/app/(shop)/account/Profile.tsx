'use client';

import { formatRub, plural } from '@aesculap/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Alert, Button, Field, Modal } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { writeCart } from '@/lib/cart';
import { orderLabel } from './orders/[number]/OrderView';
import p from './profile.module.css';
import { Stylist } from './Stylist';

export type ProfileData = {
  gender: string | null; name: string | null; age: number | null; heightCm: number | null; weightKg: number | null;
  sizeTop: string | null; sizeBottom: string | null; sizeShoes: string | null; hair: string | null; skinTone: string | null;
  colorTypeLabel: string | null; bodyType: string | null; specialtyIds: string[]; budgetLabel: string | null;
  completenessPct: number; quizCompleted: boolean; photos: { id: string; url: string }[];
};

const dash = (...v: (string | number | null | undefined)[]) => v.filter((x) => x != null && x !== '').join(' · ') || '—';

// Подписи кодов анкеты (значения — из profileUpdateSchema)
const HAIR: Record<string, string> = { light: 'Светлый', dark: 'Тёмный' };
const SKIN: Record<string, string> = { warm: 'Тёплый', cold: 'Холодный' };

/** «сегодня», «вчера» или «3 июня» (год — только если не текущий) */
function when(d: string) {
  const at = new Date(d);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  return at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export type OrderRow = { number: string; createdAt: string; status: string; total: number; shipments: number; delivery: string; shipmentStatuses: string[] };

/** Профиль покупателя (ТЗ §6.5). */
export function Profile(props: { email: string; emailVerified: boolean; welcome: boolean; profile: ProfileData; specialties: string[]; consents: Record<string, boolean>; capsule: { count: number; total: number } | null; orders: OrderRow[] }) {
  const router = useRouter();
  const [profile, setProfile] = useState(props.profile);
  const [consents, setConsents] = useState(props.consents);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
    <section className={p.page}>
      <div className={p.eyebrow}>Мой профиль</div>
      <h1 className={p.title}>Добрый день{pr.name ? `, ${pr.name}` : ''}.</h1>
      {props.welcome && (
        <div className={p.alert}>
          <Alert tone="success">Аккаунт создан. Мы отправили письмо для подтверждения email.</Alert>
        </div>
      )}
      {error && (
        <div className={p.alert}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className={p.grid}>
        <div className={p.col}>
          {/* Анкета: размеры, цветотип, специальность, бюджет */}
          <div className={p.dark}>
            <div className={p.darkMuted}>Анкета заполнена на {pr.completenessPct}%</div>
            <div className={p.bar}>
              <span style={{ width: `${pr.completenessPct}%` }} />
            </div>
            <dl className={p.rows}>
              <div>
                <dt>Пол · рост · вес</dt>
                <dd>{dash(pr.gender === 'female' ? 'Женский' : pr.gender === 'male' ? 'Мужской' : null, pr.heightCm && `${pr.heightCm} см`, pr.weightKg && `${pr.weightKg} кг`)}</dd>
              </div>
              <div>
                <dt>Размеры</dt>
                <dd>{[pr.sizeTop && `Верх: ${pr.sizeTop}`, pr.sizeBottom && `Низ: ${pr.sizeBottom}`, pr.sizeShoes && `Обувь: ${pr.sizeShoes}`].filter(Boolean).join(', ') || '—'}</dd>
              </div>
              <div>
                <dt>Тип фигуры</dt>
                <dd>{pr.bodyType ?? '—'}</dd>
              </div>
              <div>
                <dt>Цвет волос · тон кожи · цветотип</dt>
                <dd>{dash(pr.hair && (HAIR[pr.hair] ?? pr.hair), pr.skinTone && (SKIN[pr.skinTone] ?? pr.skinTone), pr.colorTypeLabel)}</dd>
              </div>
              <div>
                <dt>Специальность</dt>
                <dd>{props.specialties.join(', ') || '—'}</dd>
              </div>
              <div>
                <dt>Бюджет</dt>
                <dd>{pr.budgetLabel ?? '—'}</dd>
              </div>
            </dl>
            <Link href="/quiz/1" className={p.accentLink}>
              {pr.quizCompleted ? 'Редактировать анкету →' : 'Пройти анкету →'}
            </Link>
          </div>

          <div className={p.soft}>
            <div>
              <div className={p.eyebrow}>Моя капсула</div>
              {props.capsule ? (
                <div className={p.big}>
                  {props.capsule.count} {plural(props.capsule.count, 'вещь', 'вещи', 'вещей')} · {formatRub(props.capsule.total)}
                </div>
              ) : (
                <p className={p.note}>Капсула появится после анкеты.</p>
              )}
            </div>
            <Link href={props.capsule ? '/capsule' : '/quiz/1'} className={p.link}>
              {props.capsule ? 'Посмотреть капсулу →' : 'Пройти анкету →'}
            </Link>
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
                        <img src="/design/icons/circle-x.svg" alt="" width={36} height={36} />
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
                <p className={p.note}>Ваши фото никто не увидит, они нужны для формирования индивидуальной капсулы. Стилисту — только если вы сами покажете их в вопросе.</p>
              </>
            ) : (
              <p className={p.note}>Чтобы добавить фото, дайте согласие на их хранение в блоке «Аккаунт».</p>
            )}
          </div>

          <div className={p.card}>
            <h2>Аккаунт</h2>
            <div className={p.accountRow}>
              <span className={p.email}>
                {props.email}
                {!props.emailVerified && (
                  <button
                    className={p.textBtn}
                    disabled={resent}
                    onClick={async () => {
                      await api('/auth/resend-verification', {});
                      setResent(true);
                    }}
                  >
                    {resent ? 'письмо отправлено' : 'подтвердить email'}
                  </button>
                )}
              </span>
              <Link href="/reset-password" className={p.saleLink}>
                сменить пароль
              </Link>
            </div>
            {(
              [
                ['pdn', 'Я согласен с политикой персональных данных'],
                ['offer', 'Я согласен с офертой'],
                ['photos', 'Я согласен с хранением моих фото'],
                ['marketing', 'Хочу получать новости, подборки и письма об акциях'],
              ] as const
            ).map(([type, label]) => (
              <label key={type} className={p.consent}>
                <input
                  type="checkbox"
                  checked={Boolean(consents[type])}
                  // Отзыв согласия на ПДн или оферты = удаление аккаунта (ТЗ §6.5)
                  onChange={(e) => (!e.target.checked && (type === 'pdn' || type === 'offer') ? setDeleting(true) : consent(type, e.target.checked))}
                />
                <span>{label}</span>
              </label>
            ))}
            <div className={p.accountActions}>
              <button
                className={p.textBtnPrimary}
                onClick={async () => {
                  await api('/auth/logout', {});
                  writeCart([]);
                  localStorage.removeItem('cart-owner');
                  router.replace('/');
                  router.refresh();
                }}
              >
                Выйти
              </button>
              <a href="/api/me/export" className={p.textBtnMuted}>
                Скачать мои данные
              </a>
              <button className={p.textBtnDanger} onClick={() => setDeleting(true)}>
                Удалить аккаунт
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Консультации стилиста нет в макете — отдельной карточкой на всю ширину, чтобы не ломать сетку */}
      <div className={p.stylist}>
        <Stylist quizCompleted={pr.quizCompleted} hasPhotos={pr.photos.length > 0} />
      </div>

      <div className={p.orders}>
        <div className={p.eyebrow}>История заказов</div>
        {props.orders.length === 0 ? (
          <div className={p.orderEmpty}>
            Заказов пока нет.{' '}
            <Link href="/catalog" className={p.saleLink}>
              Перейти в каталог →
            </Link>
          </div>
        ) : (
          props.orders.map((r) => {
            const label = orderLabel({ status: r.status, shipments: r.shipmentStatuses.map((st) => ({ status: st })) });
            // Активные заказы — акцентом, завершённые и отменённые — серым, как «Завершен» в макете
            const done = r.status === 'cancelled' || label === 'Доставлен';
            return (
              <Link key={r.number} href={`/account/orders/${r.number}`} className={p.orderRow}>
                <span className={p.orderMain}>
                  <span className={p.orderTitle}>
                    № {r.number} · {when(r.createdAt)}
                  </span>
                  <span className={p.orderSub}>
                    {r.shipments} {plural(r.shipments, 'отправление', 'отправления', 'отправлений')} · {formatRub(r.total)} · {r.delivery}
                  </span>
                </span>
                <span className={done ? p.orderStatusDone : p.orderStatus}>{label} →</span>
              </Link>
            );
          })
        )}
      </div>

      {deleting && (
        <Modal eyebrow="Аккаунт" title="Удалить аккаунт?" onClose={() => setDeleting(false)}>
          <p style={{ marginBottom: 12 }}>
            Удалятся анкета, фото, капсулы, адреса и корзина; согласия будут отозваны. Сведения о заказах сохранятся — их требует бухгалтерский учёт. Отменить удаление нельзя.
          </p>
          <Field label="Пароль для подтверждения" type="password" value={password} error={deleteError ?? undefined} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <Button
              disabled={!password}
              onClick={async () => {
                setDeleteError(null);
                try {
                  await api('/me/delete', { password });
                  writeCart([]);
                  localStorage.removeItem('cart-owner');
                  localStorage.removeItem('quiz-draft-v1');
                  router.replace('/');
                  router.refresh();
                } catch (e) {
                  setDeleteError(isApiError(e) ? (e.errors?.password ?? e.message) : 'Нет связи с сервером');
                }
              }}
            >
              Удалить навсегда
            </Button>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Отмена
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
