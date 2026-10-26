import localFont from 'next/font/local';
import './fallback.css';

/*
 * Шрифты макета лежат в проекте (src/fonts, лицензия SIL OFL 1.1 — OFL.txt в папке каждого семейства), сборке не нужен
 * доступ к Google Fonts. Файлы — те же, что отдаёт Google Fonts для next/font/google (woff2, наборы latin, latin-ext, cyrillic),
 * поэтому вид не меняется. Prata — заголовки, Manrope — текст, JetBrains Mono — надзаголовки (в DM Mono из макета нет
 * кириллицы), Playfair Display — блок «Премиум». Manrope, Playfair и JetBrains Mono — вариативные (ось wght).
 *
 * Каждый набор символов — отдельный вызов localFont: у next/font/local диапазон unicode-range задаётся на весь вызов.
 * CSS-переменная (--font-…) — у вызова с latin, имя семейства у всех вызовов одно. Предзагружаются latin и cyrillic
 * Manrope, Prata и JetBrains Mono — они в первом экране каждой страницы. Playfair Display нужен только блокам «Премиум»
 * и подключается там (fonts/playfair.ts: главная и раздел /premium), поэтому предзагружается только на этих страницах.
 * latin-ext (в нём знак ₽) грузится по требованию: на медленном 4G каждый лишний предзагружаемый файл отнимает канал
 * у LCP-картинки (замеры — docs/PERF.md). Запасные шрифты с подогнанными метриками,
 * чтобы при font-display: swap текст не прыгал, — в fallback.css, с теми же значениями, что считал next/font/google.
 * Аргументы next/font должны быть литералами, поэтому диапазоны повторяются.
 */

export const prata = localFont({
  src: './prata/prata-latin.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-prata',
  preload: true,
  adjustFontFallback: false,
  fallback: ["'Prata Fallback'"],
  declarations: [
    { prop: 'font-family', value: "'Prata'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

const prataCyrillic = localFont({
  src: './prata/prata-cyrillic.woff2',
  weight: '400',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Prata'" },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});

export const sans = localFont({
  src: './manrope/manrope-latin.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-manrope',
  preload: true,
  adjustFontFallback: false,
  fallback: ["'Manrope Fallback'"],
  declarations: [
    { prop: 'font-family', value: "'Manrope'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

const sansLatinExt = localFont({
  src: './manrope/manrope-latin-ext.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Manrope'" },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});

const sansCyrillic = localFont({
  src: './manrope/manrope-cyrillic.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Manrope'" },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});

export const mono = localFont({
  src: './jetbrains-mono/jetbrains-mono-latin.woff2',
  weight: '400 500',
  style: 'normal',
  display: 'swap',
  variable: '--font-mono-face',
  preload: true,
  adjustFontFallback: false,
  fallback: ["'JetBrains Mono Fallback'"],
  declarations: [
    { prop: 'font-family', value: "'JetBrains Mono'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

const monoLatinExt = localFont({
  src: './jetbrains-mono/jetbrains-mono-latin-ext.woff2',
  weight: '400 500',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'JetBrains Mono'" },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});

const monoCyrillic = localFont({
  src: './jetbrains-mono/jetbrains-mono-cyrillic.woff2',
  weight: '400 500',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'JetBrains Mono'" },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});

/** Классы с CSS-переменными семейств — на <html>; остальные вызовы подключают свои @font-face тем, что импортированы здесь */
export const fontVariables = [prata, sans, mono].map((f) => f.variable).join(' ');

// Наборы latin-ext и cyrillic используются только через @font-face; ссылка нужна, чтобы сборщик не счёл их лишними
export const fontFaces = [prataCyrillic, sansLatinExt, sansCyrillic, monoLatinExt, monoCyrillic];
