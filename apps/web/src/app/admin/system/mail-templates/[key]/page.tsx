'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import s from '@/components/supplier/cabinet.module.css';
import { Alert, Button } from '@/components/ui';
import { api, isApiError } from '@/lib/api';

type View = {
  key: string; group: string; title: string; description: string;
  vars: { name: string; label: string; required: boolean }[];
  subject: string; text: string; defaultSubject: string; defaultText: string; customized: boolean; updatedAt: string | null;
};
type Msg = { tone: 'error' | 'success'; text: string } | null;

/** Редактор шаблона: тема и текст, переменные (клик — вставить), предпросмотр на тестовых данных, тест себе, сброс */
export default function MailTemplatePage() {
  const { key } = useParams<{ key: string }>();
  const [v, setV] = useState<View | null>(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const apply = (x: View) => {
    setV(x);
    setSubject(x.subject);
    setText(x.text);
  };
  useEffect(() => {
    api<View>(`/admin/system/mail-templates/${key}`).then(apply).catch((e) => setMsg({ tone: 'error', text: isApiError(e) ? e.message : 'Ошибка' }));
  }, [key]);

  const run = async <T,>(fn: () => Promise<T>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    setErrors({});
    try {
      const r = await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      return r;
    } catch (e) {
      if (isApiError(e)) {
        setErrors(e.errors ?? {});
        setMsg({ tone: 'error', text: e.message });
      } else setMsg({ tone: 'error', text: 'Нет связи с сервером' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Вставить {{переменную}} в текст на место курсора */
  const insert = (name: string) => {
    const el = area.current;
    const token = `{{${name}}}`;
    if (!el) return setText((t) => t + token);
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const next = text.slice(0, a) + token + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  if (!v) return msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null;
  const draft = { subject, text };
  const dirty = subject !== v.subject || text !== v.text;

  return (
    <>
      <div className={s.head}>
        <div>
          <div className="eyebrow">
            <Link href="/admin/system/mail-templates">Шаблоны писем</Link> · {v.group}
          </div>
          <h1>{v.title}</h1>
          <div className={s.muted}>
            {v.description} {v.customized ? `Изменён ${new Date(v.updatedAt!).toLocaleString('ru-RU')}.` : 'Стандартный текст.'}
          </div>
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className={s.detail} style={{ marginTop: 16 }}>
        <section className={s.panel} style={{ display: 'grid', gap: 14, alignContent: 'start', minWidth: 0 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className={s.muted}>Тема письма</span>
            <input className={s.input} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} aria-invalid={Boolean(errors.subject)} aria-describedby={errors.subject ? 'subject-error' : undefined} />
            {errors.subject && (
              <span id="subject-error" style={{ color: 'var(--c-error)', fontSize: 13 }}>
                {errors.subject}
              </span>
            )}
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className={s.muted}>Текст письма (обычный текст)</span>
            <textarea
              ref={area}
              className={s.input}
              rows={14}
              style={{ width: '100%', height: 'auto', padding: 12, font: '400 14px/1.5 var(--font-mono)' }}
              value={text}
              maxLength={10000}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={Boolean(errors.text)}
              aria-describedby={errors.text ? 'text-error' : undefined}
            />
            {errors.text && (
              <span id="text-error" style={{ color: 'var(--c-error)', fontSize: 13 }}>
                {errors.text}
              </span>
            )}
          </label>
          <div className={s.actions}>
            <Button disabled={busy || !dirty} onClick={() => run(() => api<View>(`/admin/system/mail-templates/${key}`, draft, 'PUT'), 'Шаблон сохранён').then((x) => x && apply(x))}>
              Сохранить
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => run(() => api<{ subject: string; text: string }>(`/admin/system/mail-templates/${key}/preview`, draft)).then((x) => x && setPreview(x))}>
              Предпросмотр
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => run(() => api<{ to: string }>(`/admin/system/mail-templates/${key}/test`, draft)).then((x) => x && setMsg({ tone: 'success', text: `Тестовое письмо отправлено на ${x.to}` }))}>
              Отправить себе тест
            </Button>
            {v.customized && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('Вернуть стандартный текст? Ваши правки будут удалены.')) return;
                  void run(() => api<View>(`/admin/system/mail-templates/${key}`, undefined, 'DELETE'), 'Возвращён стандартный текст').then((x) => x && apply(x));
                }}
              >
                Сбросить к стандартному
              </Button>
            )}
          </div>
          {preview && (
            <div aria-live="polite">
              <h2 style={{ fontSize: 20 }}>Предпросмотр на тестовых данных</h2>
              <p>
                <b>Тема:</b> {preview.subject}
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', font: '400 14px/1.6 var(--font-sans)', background: 'var(--c-surface-soft)', padding: 16, borderRadius: 12, margin: 0 }}>{preview.text}</pre>
            </div>
          )}
        </section>
        <section className={s.panel} style={{ alignContent: 'start', minWidth: 0 }}>
          <h2>Переменные</h2>
          <p className={s.muted}>Нажмите, чтобы вставить в текст. Обязательные удалить нельзя.</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {v.vars.map((x) => (
              <li key={x.name}>
                <button type="button" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--c-sale)' }} onClick={() => insert(x.name)}>
                  {`{{${x.name}}}`}
                </button>
                {x.required && <span className={`${s.badge} ${s.b_pending}`} style={{ marginLeft: 6 }}>обязательна</span>}
                <div className={s.muted}>{x.label}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
