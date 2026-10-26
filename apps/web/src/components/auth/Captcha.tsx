'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { loadScript } from '@/lib/load-script';
import s from './auth.module.css';

type SmartCaptchaApi = {
  render(el: HTMLElement, opts: { sitekey: string; hl?: string; callback?: (token: string) => void }): number;
  reset(id?: number): void;
  destroy(id?: number): void;
};
declare global {
  interface Window {
    smartCaptcha?: SmartCaptchaApi;
  }
}

const SCRIPT = 'https://smartcaptcha.yandexcloud.net/captcha.js?render=onload';

/** Ключ клиента берём у API только после первого captcha_required — без ключа запросов нет вовсе. */
let siteKey: Promise<string | null> | null = null;
const getSiteKey = () =>
  (siteKey ??= api<{ siteKey: string | null }>('/auth/captcha-config')
    .then((r) => r.siteKey)
    .catch(() => {
      siteKey = null;
      return null;
    }));

async function smartCaptchaReady(): Promise<SmartCaptchaApi> {
  await loadScript(SCRIPT);
  // При render=onload объект появляется чуть позже события load
  for (let i = 0; i < 50 && !window.smartCaptcha; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.smartCaptcha) throw new Error('SmartCaptcha не загрузилась');
  return window.smartCaptcha;
}

/** Виджет Яндекс SmartCaptcha; токен отдаётся через onToken, resetKey сбрасывает виджет (токен одноразовый). */
function CaptchaWidget({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: SmartCaptchaApi; id: number } | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      const key = await getSiteKey();
      if (!key || stop) return;
      const sc = await smartCaptchaReady();
      if (stop || !box.current) return;
      const id = sc.render(box.current, { sitekey: key, hl: 'ru', callback: (t) => tokenCb.current(t) });
      widget.current = { api: sc, id };
    })().catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
      if (widget.current) widget.current.api.destroy(widget.current.id);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey && widget.current) widget.current.api.reset(widget.current.id);
  }, [resetKey]);

  return (
    <div className={s.captcha}>
      <div ref={box} />
      {failed && <p className={s.captchaNote}>Не удалось загрузить проверку. Обновите страницу или попробуйте позже.</p>}
    </div>
  );
}

/**
 * Капча после превышения лимитов (E6-06). Сервер отвечает 429 с кодом captcha_required — форма вызывает require(),
 * показывает element и, когда пользователь решил капчу, onSolved повторяет запрос с заголовком из take().
 * Пока сервер капчу не попросил, ничего не грузится и не рендерится.
 */
export function useCaptcha(onSolved: () => void): { element: ReactNode; require: () => void; take: () => Record<string, string> | undefined } {
  const [active, setActive] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const token = useRef<string | null>(null);
  const solved = useRef(onSolved);
  solved.current = onSolved;

  const onToken = useCallback((t: string) => {
    token.current = t;
    solved.current();
  }, []);

  const take = useCallback(() => {
    const t = token.current;
    if (!t) return undefined;
    // Токен одноразовый: после отправки виджет сбрасывается, на следующий captcha_required — решить заново
    token.current = null;
    setResetKey((k) => k + 1);
    return { 'X-Captcha-Token': t };
  }, []);

  const require = useCallback(() => setActive(true), []);

  return { element: active ? <CaptchaWidget onToken={onToken} resetKey={resetKey} /> : null, require, take };
}
