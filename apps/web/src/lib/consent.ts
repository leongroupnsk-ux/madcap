'use client';

/** Выбор в cookie-баннере (ТЗ §4.1, §10): "all" — можно аналитику, "essential" — только необходимые. */
export const CONSENT_KEY = 'cookie-consent';
export const CONSENT_EVENT = 'cookie-consent-change';
export type Consent = 'all' | 'essential';

export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'all' || v === 'essential' ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(value: Consent) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* приватный режим — баннер просто закроется, согласие живёт до перезагрузки */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

/** Аналитические cookie разрешены (значение из браузера или выбор в баннере в этой вкладке) */
export const analyticsAllowed = () => readConsent() === 'all';
