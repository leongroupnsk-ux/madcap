'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import s from './auth.module.css';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string };

/** Поле формы входа по макету: подпись капсом, инпут 50 px со скруглением 12, глаз у пароля. */
export function AuthField({ label, error, type, ...rest }: Props) {
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
          className={`${s.input} ${isPassword ? s.inputPassword : ''} ${error ? s.inputError : ''}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className={`${s.eye} ${shown ? s.eyeShown : ''}`}
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
            aria-pressed={shown}
          >
            <img src="/design/icons/password-eye.svg" alt="" width={20} height={20} />
          </button>
        )}
      </div>
      {error && (
        <span id={`${id}-err`} className={s.error}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Чекбокс согласия по макету: квадрат 18 px с рамкой 1.5 px. По умолчанию не отмечен. */
export function AuthCheckbox({ children, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className={s.checkRow}>
      <label className={s.check}>
        <input type="checkbox" className={s.checkBox} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
        <span>{children}</span>
      </label>
      {error && (
        <span id={`${id}-err`} className={s.error}>
          {error}
        </span>
      )}
    </div>
  );
}
