/**
 * Разбор поисковой строки каталога: нормализация, синонимы, исправление опечаток по словарю витрины.
 * Сам поиск (SQL) — в CatalogService.searchIds; здесь только чистые функции, их удобно тестировать.
 */

/** Неверная раскладка: «rjcnfv» → «костюм» (ТЗ §4.1). */
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
export function swapLayout(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((c) => {
      const i = EN.indexOf(c);
      if (i >= 0) return RU[i];
      const j = RU.indexOf(c);
      return j >= 0 ? EN[j] : c;
    })
    .join('');
}

/** Нижний регистр, ё → е, одиночные пробелы, не длиннее 100 символов. */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/**
 * Синонимы: группы равнозначных названий. Запрос с любым членом группы ищет и по остальным
 * (фраза заменяется целиком: «медицинский халат» → «халат»). Правка — здесь, в коде; в админке не нужна.
 */
export const SYNONYMS: string[][] = [
  ['скраб', 'скрабы', 'костюм', 'хирургичка', 'хирургический костюм', 'медицинский костюм', 'медкостюм', 'scrubs', 'scrub'],
  ['халат', 'медицинский халат', 'медхалат', 'врачебный халат', 'лабораторный халат'],
  ['сабо', 'кроксы', 'крокс', 'crocs', 'медицинская обувь', 'обувь медицинская', 'обувь', 'медицинские тапочки', 'тапочки', 'тапки', 'шлепанцы'],
  ['шапочка', 'колпак', 'шапка', 'медицинская шапочка', 'хирургическая шапочка', 'бандана'],
  ['брюки', 'штаны', 'медицинские брюки', 'джоггеры'],
  ['топ', 'блуза', 'блузка', 'туника', 'рубашка', 'медицинская блуза'],
  ['футболка', 'майка', 'медицинская футболка'],
  ['бейдж', 'бэйдж', 'бейджик'],
  ['маска', 'медицинская маска'],
];

/** Слова, которые сами по себе ничего не уточняют: в условии «все слова» не участвуют, если есть другие. */
const STOP = new Set(['медицинский', 'медицинская', 'медицинские', 'медицинское', 'медицинскую', 'мед', 'для', 'и', 'с', 'со', 'в', 'на', 'по', 'из', 'от']);

/** Слова запроса: разделитель — пробел, кавычки и скобки по краям слова отбрасываются (точку и запятую — нет: в другой раскладке это буквы). */
export function words(q: string): string[] {
  return q
    .split(' ')
    .map((w) => w.replace(/^[«»"'()]+|[«»"'()]+$/g, ''))
    .filter(Boolean);
}

/** Значимые слова для условия «все слова»: без стоп-слов (если после них что-то остаётся) и однобуквенных. */
export function significant(ws: string[]): string[] {
  const long = ws.filter((w) => w.length >= 2);
  const meaningful = long.filter((w) => !STOP.has(w));
  return meaningful.length ? meaningful : long;
}

/** Варианты строки по синонимам: каждая найденная фраза группы заменяется на остальных членов группы. */
export function expandSynonyms(q: string, limit = 8): string[] {
  const out = new Set([q]);
  const padded = ` ${q} `;
  for (const group of SYNONYMS) {
    // Сначала длинные фразы: «медицинский халат» раньше «халат»
    const hit = [...group].sort((a, b) => b.length - a.length).find((term) => padded.includes(` ${term} `));
    if (!hit) continue;
    for (const alt of group) {
      if (alt === hit) continue;
      out.add(padded.replace(` ${hit} `, ` ${alt} `).trim());
      if (out.size >= limit) return [...out];
    }
  }
  return [...out];
}

/** Расстояние Дамерау — Левенштейна (вставка, удаление, замена, перестановка соседних); с отсечкой по max. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/**
 * Сколько опечаток допускаем в слове: 3 буквы — одна замена или перестановка (длина та же),
 * 4–6 — одна, от 7 — две. Триграммы pg_trgm на коротких словах почти не работают — для них это главный путь.
 */
export function typoBudget(len: number): number {
  if (len < 3) return 0;
  if (len < 7) return 1;
  return 2;
}

/**
 * Исправления слова по словарю витрины (слова из названий товаров, брендов и категорий).
 * Слово, которое и так встречается в словаре (целиком или как часть), не исправляется.
 * Сравнение — со словом словаря целиком и с его началом той же длины (недописанное слово с опечаткой: «кастю» → «костюм»).
 */
export function corrections(word: string, vocab: string[], budget = typoBudget(word.length), take = 3): string[] {
  if (budget === 0 || /\d/.test(word)) return [];
  if (vocab.some((v) => v.includes(word))) return [];
  const scored: { w: string; d: number }[] = [];
  for (const v of vocab) {
    if (word.length === 3 && v.length !== 3) continue;
    let d = editDistance(word, v, budget);
    if (word.length >= 4 && v.length > word.length) d = Math.min(d, editDistance(word, v.slice(0, word.length), budget));
    if (d <= budget) scored.push({ w: v, d });
  }
  return scored
    .sort((a, b) => a.d - b.d || a.w.length - b.w.length || a.w.localeCompare(b.w))
    .slice(0, take)
    .map((x) => x.w);
}

/** Слова для словаря: буквенно-цифровые части текста длиной от 3 символов. */
export function vocabWords(text: string): string[] {
  return normalizeQuery(text)
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 3);
}

/** Похоже на ПДн (email, телефон, длинный номер) — такой запрос в журнал пустых запросов не пишется. */
export function looksPersonal(q: string): boolean {
  return /@/.test(q) || (q.match(/\d/g)?.length ?? 0) >= 7;
}
