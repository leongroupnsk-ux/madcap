'use client';

import { formatRub, plural, premiumLeadSchema, type PremiumAnswers } from '@aesculap/shared';
import { useState } from 'react';
import s from '@/components/premium/premium.module.css';
import { useEscape } from '@/components/ui';
import { api, isApiError } from '@/lib/api';
import { imgSet } from '@/lib/image';
import type { PremiumCapsule } from './CapsuleView';

/** Маска телефона: +7 (999) 123-45-67 */
function maskPhone(v: string) {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d && !d.startsWith('7')) d = `7${d}`;
  d = d.slice(0, 11);
  const p = d.slice(1);
  if (!d) return '';
  let out = '+7';
  if (p.length) out += ` (${p.slice(0, 3)}`;
  if (p.length >= 3) out += ')';
  if (p.length > 3) out += ` ${p.slice(3, 6)}`;
  if (p.length > 6) out += `-${p.slice(6, 8)}`;
  if (p.length > 8) out += `-${p.slice(8, 10)}`;
  return out;
}

/** Окно заявки (кадр premium-call-me 290:4335): менеджер перезванивает, онлайн-оплаты в премиуме нет. */
export function LeadModal({ cap, answers, overrides, onClose }: { cap: PremiumCapsule; answers: PremiumAnswers; overrides: Record<string, string>; onClose: () => void }) {
  useEscape(onClose);
  const [name, setName] = useState(answers.name ?? '');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState<'phone' | 'whatsapp'>('phone');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Ошибка поля пропадает, как только его поправили
  const fix = (k: string) => setErrors((e) => Object.fromEntries(Object.entries(e).filter(([x]) => x !== k && x !== '_')));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, phone, contact, consent, answers, variantNo: cap.variantNo, overrides };
    const parsed = premiumLeadSchema.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api('/premium/leads', body);
      setSent(true);
    } catch (err) {
      setErrors(isApiError(err) ? (err.errors ?? { _: err.message }) : { _: 'Нет связи с сервером' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={`${s.dialog} ${s.lead2}`} role="dialog" aria-modal="true" aria-label="Оставьте контакты" onClick={(e) => e.stopPropagation()}>
        <div className={s.leadLeft}>
          <span className={s.eyebrow}>ПЕРСОНАЛЬНАЯ КАПСУЛА</span>
          <h2>Ваша капсула готова</h2>
          <div className={s.leadName}>
            <b>{cap.title}</b>
            <span>
              {cap.count} {plural(cap.count, 'вещь', 'вещи', 'вещей')}
              {cap.size ? `     ·     Размер ${cap.size}` : ''}
            </span>
          </div>
          <div className={s.thumbs}>
            {cap.items.map((it) => (
              <div key={it.slot} className={s.thumb}>
                {it.image ? <img {...imgSet(it.imageSet, '96px', it.image)} alt="" /> : <img alt="" />}
                <b title={it.title}>{it.title}</b>
                <span>{formatRub(it.price)}</span>
              </div>
            ))}
          </div>
          <div className={s.leadDivider} />
          <div className={s.leadTotal}>
            <span>Итоговая стоимость</span>
            <b>{formatRub(cap.total)}</b>
          </div>
        </div>
        <div className={s.leadRight}>
          <button type="button" className={s.close} onClick={onClose} aria-label="Закрыть">
            <img src="/design/premium/plus.svg" width={15.5} height={15.5} alt="" />
          </button>
          {sent ? (
            <div className={s.sent} role="status">
              <h3>Заявка отправлена</h3>
              <p>
                Спасибо, {name.trim()}! Менеджер свяжется с вами {contact === 'whatsapp' ? 'в WhatsApp' : 'по телефону'} в ближайшее время, подтвердит состав капсулы, размеры и
                доставку и ответит на все вопросы.
              </p>
              <button type="button" className={s.submit} onClick={onClose}>
                Готово
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h3>Оставьте контакты</h3>
              <p style={{ margin: 0, padding: '10px 0', fontSize: 10, lineHeight: '14px' }}>
                Наш менеджер свяжется с вами в ближайшее время для подтверждения заказа, уточнения деталей и ответит на все вопросы.
              </p>
              <div className={s.leadForm}>
                <label className={s.leadField}>
                  <span>Ваше имя *</span>
                  <input value={name} onChange={(e) => (setName(e.target.value), fix('name'))} placeholder="Например, Анна" autoComplete="name" maxLength={60} aria-invalid={Boolean(errors.name)} />
                  {errors.name && <p className={s.leadErr}>{errors.name}</p>}
                </label>
                <label className={s.leadField}>
                  <span>Телефон *</span>
                  <input value={phone} onChange={(e) => (setPhone(maskPhone(e.target.value)), fix('phone'))} placeholder="+7 (999) 123-45-67" inputMode="tel" autoComplete="tel" aria-invalid={Boolean(errors.phone)} />
                  {errors.phone && <p className={s.leadErr}>{errors.phone}</p>}
                </label>
                <div role="radiogroup" aria-label="Удобный способ связи">
                  <span className={s.leadLabel}>Удобный способ связи</span>
                  <div className={s.radios}>
                    {(
                      [
                        ['phone', 'Телефон'],
                        ['whatsapp', 'WhatsApp'],
                      ] as const
                    ).map(([v, l]) => (
                      <label key={v} className={s.radio}>
                        <input type="radio" name="contact" checked={contact === v} onChange={() => setContact(v)} />
                        {l}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {errors._ && <p className={s.leadErr} style={{ marginTop: 12 }}>{errors._}</p>}
              <button type="submit" className={s.submit} disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Отправляем…' : 'Отправить заявку'}
              </button>
              <div className={s.secure}>
                <img src="/design/premium/lock.svg" width={15} height={16.5} alt="" />
                Ваши данные защищены и не будут переданы третьим лицам
              </div>
              <label className={s.policy}>
                <input type="checkbox" checked={consent} onChange={(e) => (setConsent(e.target.checked), fix('consent'))} />
                <span>
                  Соглашаюсь с{' '}
                  <a href="/legal/privacy" target="_blank" rel="noreferrer">
                    политикой конфиденциальности
                  </a>
                </span>
              </label>
              {errors.consent && <p className={s.leadErr} style={{ textAlign: 'center', marginTop: 6 }}>{errors.consent}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
