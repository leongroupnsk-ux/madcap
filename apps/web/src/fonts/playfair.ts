import localFont from 'next/font/local';

/*
 * Playfair Display — только блоки «Премиум» (премиум-баннер главной и раздел /premium). Подключается в этих местах, а не в
 * корневом layout: next/font предзагружает шрифт только на страницах, которые его импортируют. Класс playfair.variable
 * ставится на обёртку блока вместе с переопределением --font-display (см. home.module.css .premium, premium.module.css .root):
 * переменная в :root вычисляется там, где --font-playfair ещё не задан. Подробности о наборах — fonts/index.ts.
 */
export const playfair = localFont({
  src: './playfair/playfair-latin.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-playfair',
  preload: true,
  adjustFontFallback: false,
  fallback: ["'Playfair Display Fallback'"],
  declarations: [
    { prop: 'font-family', value: "'Playfair Display'" },
    { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  ],
});

const playfairLatinExt = localFont({
  src: './playfair/playfair-latin-ext.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Playfair Display'" },
    { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' },
  ],
});

const playfairCyrillic = localFont({
  src: './playfair/playfair-cyrillic.woff2',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'Playfair Display'" },
    { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
  ],
});

// Наборы latin-ext и cyrillic подключаются только через @font-face; ссылка нужна, чтобы сборщик не счёл их лишними
export const playfairFaces = [playfairLatinExt, playfairCyrillic];
