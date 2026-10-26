'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import s from './ui.module.css';

type Variant = 'primary' | 'accent' | 'outline' | 'soft' | 'ghost';
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  block,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  return <button className={cx(s.btn, s[variant], block && s.block, className)} {...rest} />;
}

export function ButtonLink({ href, variant = 'primary', children }: { href: string; variant?: Variant; children: ReactNode }) {
  return (
    <Link href={href} className={cx(s.btn, s[variant])}>
      {children}
    </Link>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };

export function Field({ label, error, hint, type, ...rest }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      <div className={s.inputWrap}>
        <input
          id={id}
          type={isPassword && shown ? 'text' : type}
          className={cx(s.input, error && s.inputError)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          {...rest}
        />
        {isPassword && (
          <button type="button" className={s.eye} onClick={() => setShown((v) => !v)} aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}>
            {shown ? '◡' : '◉'}
          </button>
        )}
      </div>
      {error ? (
        <span id={`${id}-err`} className={s.error}>
          {error}
        </span>
      ) : (
        hint && <span className={s.hint}>{hint}</span>
      )}
    </div>
  );
}

export function Checkbox({ children, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode; error?: string }) {
  return (
    <div className={s.field}>
      <label className={s.check}>
        <input type="checkbox" {...rest} />
        <span>{children}</span>
      </label>
      {error && <span className={s.error}>{error}</span>}
    </div>
  );
}

export function Chip({ active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" aria-pressed={active} className={cx(s.chip, active && s.chipActive)} {...rest} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.card, className)}>{children}</div>;
}

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx(s.alert, tone === 'error' ? s.alertError : s.alertSuccess)}>
      {children}
    </div>
  );
}

export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Фокус модального окна (WAI-ARIA dialog): при открытии — в окно (на первое поле формы, иначе на само окно,
 * чтобы Enter случайно не нажал «Отправить»), Tab и Shift+Tab ходят по кругу внутри окна,
 * при закрытии фокус возвращается на элемент, который открыл окно.
 */
function useDialogFocus() {
  const ref = useRef<HTMLDivElement & HTMLElement>(null);
  // Элемент с фокусом до открытия — запоминаем при первом рендере, до autoFocus полей внутри окна
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    if (!box.contains(document.activeElement)) {
      const field = box.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
      (field ?? box).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return e.preventDefault();
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === box || !box.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);
  return ref;
}

function PanelHead({ eyebrow, title, onClose }: { eyebrow?: string; title: string; onClose: () => void }) {
  return (
    <div className={s.panelHead}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 style={{ fontSize: 30 }}>{title}</h2>
      </div>
      <button type="button" className={s.close} onClick={onClose} aria-label="Закрыть">
        ×
      </button>
    </div>
  );
}

/** Модальное окно по центру (таблица размеров, «Заменить»). */
export function Modal({ eyebrow, title, onClose, children }: { eyebrow?: string; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  const ref = useDialogFocus();
  return (
    <div className={s.overlay} onClick={onClose}>
      <div ref={ref} tabIndex={-1} className={s.modal} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <PanelHead eyebrow={eyebrow} title={title} onClose={onClose} />
        {children}
      </div>
    </div>
  );
}

/** Боковая панель справа (фильтры, адрес доставки). */
export function Drawer({ eyebrow, title, onClose, children }: { eyebrow?: string; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  const ref = useDialogFocus();
  return (
    <div className={s.overlay} onClick={onClose}>
      <aside ref={ref} tabIndex={-1} className={s.drawer} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <PanelHead eyebrow={eyebrow} title={title} onClose={onClose} />
        {children}
      </aside>
    </div>
  );
}
