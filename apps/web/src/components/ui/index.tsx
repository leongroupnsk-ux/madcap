'use client';

import Link from 'next/link';
import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
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

function PanelHead({ eyebrow, title, onClose }: { eyebrow?: string; title: string; onClose: () => void }) {
  return (
    <div className={s.panelHead}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 style={{ fontSize: 30 }}>{title}</h2>
      </div>
      <button className={s.close} onClick={onClose} aria-label="Закрыть">
        ×
      </button>
    </div>
  );
}

/** Модальное окно по центру (таблица размеров, «Заменить»). */
export function Modal({ eyebrow, title, onClose, children }: { eyebrow?: string; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <PanelHead eyebrow={eyebrow} title={title} onClose={onClose} />
        {children}
      </div>
    </div>
  );
}

/** Боковая панель справа (фильтры, адрес доставки). */
export function Drawer({ eyebrow, title, onClose, children }: { eyebrow?: string; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className={s.overlay} onClick={onClose}>
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <PanelHead eyebrow={eyebrow} title={title} onClose={onClose} />
        {children}
      </aside>
    </div>
  );
}
