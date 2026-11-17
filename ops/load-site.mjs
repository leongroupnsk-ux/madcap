#!/usr/bin/env node
/**
 * Нагрузочный тест сайта целиком (шаг 1.9 плана запуска, docs/LOAD.md). Виртуальные посетители ходят по страницам
 * как браузер: HTML страницы (рендер Next.js), её JS, CSS, шрифты и фото (один раз на посетителя, дальше из кэша
 * браузера), запросы страницы к API после загрузки. Часть посетителей — с входом: проходят анкету, получают капсулу,
 * кладут её в корзину и доходят до оформления. Заказ не создаётся: ни оплаты, ни записей в заказах.
 *
 *   node ops/load-site.mjs http://localhost:4010
 *   LOAD_USERS=load-users.json LOAD_STAGES=50:60,200:120 node ops/load-site.mjs https://домен
 *
 * Без зависимостей, Node ≥ 22: запускается с любой машины или на сервере в сети docker (docs/LOAD.md).
 *
 * Переменные окружения:
 *   LOAD_STAGES   ступени «посетителей:секунд» через запятую (50:60,100:60,200:120,400:60)
 *   LOAD_THINK    пауза посетителя между страницами, секунд «от-до» (3-8)
 *   LOAD_USERS    файл от apps/api/scripts/load-users.ts — сессии покупателей для сценария с анкетой
 *   LOAD_BUYERS   доля посетителей с входом (0.2, если задан LOAD_USERS)
 *   LOAD_IMAGES   сколько фото со страницы грузит посетитель (12 — первый экран и немного прокрутки)
 *   LOAD_FAKE_IP  1 (по умолчанию) — у каждого посетителя свой адрес в X-Forwarded-For из 198.18.0.0/15 (диапазон
 *                 для тестов сетей, RFC 2544), и ответ 429 — ошибка: настоящий покупатель получил бы отказ. Действует,
 *                 когда тест идёт к сайту мимо Caddy (локально или в сети docker на сервере).
 *                 0 — тест через Caddy (https://домен): Caddy ставит настоящий адрес, все посетители — с одного IP
 *                 и упираются в лимиты API на IP; 429 тогда ожидаемы и ошибкой не считаются
 *   LOAD_REPORT   сохранить итог в JSON
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = (process.argv[2] ?? process.env.LOAD_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const ORIGIN = process.env.LOAD_ORIGIN ?? new URL(BASE).origin;
const STAGES = (process.env.LOAD_STAGES ?? '50:60,100:60,200:120,400:60').split(',').map((s) => {
  const [users, seconds] = s.split(':').map(Number);
  if (!(users > 0 && seconds > 0)) throw new Error(`LOAD_STAGES: «${s}» — нужно «посетителей:секунд»`);
  return { users, seconds };
});
const [THINK_MIN, THINK_MAX] = (process.env.LOAD_THINK ?? '3-8').split('-').map(Number);
const USERS = process.env.LOAD_USERS ? JSON.parse(readFileSync(process.env.LOAD_USERS, 'utf8')) : null;
const BUYERS = USERS ? Number(process.env.LOAD_BUYERS ?? 0.2) : 0;
const IMAGES = Number(process.env.LOAD_IMAGES ?? 12);
const FAKE_IP = process.env.LOAD_FAKE_IP !== '0';
const TIMEOUT_MS = 30_000;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/**
 * Нормы, мс, по p95: API — 300 (ТЗ §11), сборка капсулы — 2 000 (ТЗ §13), страница — 800 («хорошее» время ответа
 * сервера по web.dev; здесь до последнего байта HTML, это строже), статика и фото — 500.
 */
const GROUPS = {
  page: { label: 'Страница', limit: 800 },
  build: { label: 'Сборка', limit: 2000 },
  api: { label: 'API', limit: 300 },
  asset: { label: 'Файлы', limit: 500 },
};

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SHOES = ['36', '37', '38', '39', '40', '41', '42', '43'];
const BUDGETS = ['5_10', '10_15', '15_25', 'gt25'];
const SORTS = ['', 'price_asc', 'price_desc'];
const WORDS = ['костюм', 'халат', 'топ', 'брюки', 'блуза', 'сабо', 'хирург', 'комфорт', 'туника', 'жилет', 'rjcnev', 'хлат'];

const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;
const uniq = (a) => [...new Set(a)];
const decode = (s) => s.replaceAll('&amp;', '&');
const think = () => sleep((THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)) * 1000);

// ── Учёт ──────────────────────────────────────────────────────────────────────

const stats = [];
let stageNo = -1;
const errorSamples = new Map();

function rec(group, name, ms, status, path) {
  const st = stats[stageNo];
  if (!st) return;
  const key = `${group}|${name}`;
  let r = st.kinds.get(key);
  if (!r) st.kinds.set(key, (r = { group, name, lat: [], ok: 0, s4xx: 0, s429: 0, s5xx: 0, net: 0 }));
  r.lat.push(ms);
  st.requests++;
  if (status === 0) r.net++;
  else if (status >= 500) r.s5xx++;
  else if (status === 429) r.s429++;
  else if (status >= 400) r.s4xx++;
  else r.ok++;
  if ((status === 0 || status >= 400) && errorSamples.size < 20) {
    const k = `${status} ${name}`;
    if (!errorSamples.has(k)) errorSamples.set(k, path);
  }
}

function pct(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;
}

// ── Запросы ───────────────────────────────────────────────────────────────────

async function req(vu, group, name, path, { method = 'GET', body, read = false } = {}) {
  const headers = { 'user-agent': UA, 'accept-language': 'ru-RU,ru;q=0.9', 'accept-encoding': 'gzip, br' };
  if (vu.ip) headers['x-forwarded-for'] = vu.ip;
  if (vu.sid) headers.cookie = `sid=${vu.sid}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = ORIGIN;
  const t = performance.now();
  try {
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    // Тело читается всегда: время — до последнего байта, соединение возвращается в пул
    const text = await res.text();
    rec(group, name, performance.now() - t, res.status, path);
    return { status: res.status, text: read ? text : '' };
  } catch {
    rec(group, name, performance.now() - t, 0, path);
    return { status: 0, text: '' };
  }
}

const json = (r) => {
  try {
    return r.text ? JSON.parse(r.text) : null;
  } catch {
    return null;
  }
};

/** Не больше n запросов одновременно — как браузер, который тянет файлы страницы параллельно. */
async function pool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) await tasks[i++]();
  }));
}

/** Фото страницы: из srcset — ближайшее не меньше 360w (телефон, карточка в два столбца), иначе src. */
function images(html) {
  const out = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    let url = /\ssrc="([^"]+)"/.exec(tag)?.[1];
    const set = /\ssrcset="([^"]+)"/i.exec(tag)?.[1];
    if (set) {
      const c = set.split(',').map((s) => s.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 }));
      url = (c.filter((x) => x.w >= 360).sort((a, b) => a.w - b.w)[0] ?? c.at(-1))?.u ?? url;
    }
    if (url?.startsWith('/')) out.push(decode(url));
  }
  return uniq(out);
}

async function page(vu, name, path) {
  const r = await req(vu, 'page', name, path, { read: true });
  const html = r.text;
  const assets = uniq([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => decode(m[1]))).filter((u) => !vu.cache.has(u));
  const imgs = images(html).filter((u) => !vu.cache.has(u)).slice(0, IMAGES);
  for (const u of [...assets, ...imgs]) vu.cache.add(u);
  await pool([...assets.map((u) => () => req(vu, 'asset', 'статика: JS, CSS, шрифты', u)), ...imgs.map((u) => () => req(vu, 'asset', 'фото', u))], 6);
  const links = uniq([...html.matchAll(/href="\/product\/([^"?#]+)"/g)].map((m) => m[1]));
  if (links.length) vu.links = links;
  // Вошедший покупатель: шапка синхронизирует корзину и избранное на каждой странице
  if (vu.sid) await Promise.all([req(vu, 'api', 'корзина и избранное в шапке', '/api/cart'), req(vu, 'api', 'корзина и избранное в шапке', '/api/me/favorites/ids')]);
  return r;
}

// ── Сценарии ──────────────────────────────────────────────────────────────────

let D = { products: [], categories: [] };

async function productPage(vu) {
  const slug = vu.links.length && chance(0.7) ? pickOne(vu.links) : pickOne(D.products);
  await page(vu, 'товар', `/product/${slug}`);
  await req(vu, 'api', 'доставка на странице товара', `/api/catalog/products/${encodeURIComponent(slug)}/delivery`);
}

async function catalogPage(vu) {
  const r = Math.random();
  if (r < 0.4) await page(vu, 'каталог', `/catalog${chance(0.5) ? `?page=${2 + Math.floor(Math.random() * 4)}` : ''}`);
  else if (r < 0.75) await page(vu, 'каталог', `/catalog/${pickOne(D.categories)}`);
  else {
    // Фильтр: панель запрашивает выдачу для счётчика, затем переход на страницу с фильтром
    const q = new URLSearchParams({ category: pickOne(D.categories), size: pickOne(SIZES) });
    const sort = pickOne(SORTS);
    if (sort) q.set('sort', sort);
    await req(vu, 'api', 'фильтр каталога', `/api/catalog/products?${q}`);
    await page(vu, 'каталог', `/catalog?${q}`);
  }
}

async function search(vu) {
  const w = pickOne(WORDS);
  for (let i = 3; i <= Math.min(w.length, 5); i++) {
    await req(vu, 'api', 'подсказки поиска', `/api/catalog/suggest?q=${encodeURIComponent(w.slice(0, i))}`);
    await sleep(300);
  }
  await page(vu, 'поиск', `/search?q=${encodeURIComponent(w)}`);
}

async function browse(vu, steps) {
  for (let i = 0; i < steps && alive(vu); i++) {
    await think();
    const x = Math.random();
    if (x < 0.45) await productPage(vu);
    else if (x < 0.75) await catalogPage(vu);
    else if (x < 0.9) await search(vu);
    else await page(vu, 'главная', '/');
  }
}

/** Гость: пришёл на главную, в каталог или сразу в товар (из поиска), 3–10 переходов. */
async function guest(vu) {
  const r = Math.random();
  if (r < 0.5) await page(vu, 'главная', '/');
  else if (r < 0.75) await catalogPage(vu);
  else await productPage(vu);
  await browse(vu, 3 + Math.floor(Math.random() * 8));
}

/** Покупатель с входом: анкета → капсула → корзина → оформление (без заказа) → ещё немного по витрине. */
async function buyer(vu) {
  await page(vu, 'главная', '/');
  const top = pickOne(SIZES);
  const answers = [
    { gender: chance(0.8) ? 'female' : 'male', name: 'Тест', age: 25 + Math.floor(Math.random() * 30) },
    { heightCm: 155 + Math.floor(Math.random() * 35), weightKg: 50 + Math.floor(Math.random() * 40), sizeTop: top, sizeBottom: chance(0.7) ? top : pickOne(SIZES), sizeShoes: pickOne(SHOES) },
    { skinTone: pickOne(['warm', 'cold']), hair: pickOne(['light', 'dark']), eyes: pickOne(['light', 'dark']) },
    { specialtyIds: [pickOne(USERS.specialtyIds)] },
    { budgetRange: pickOne(BUDGETS) },
  ];
  for (const [i, a] of answers.entries()) {
    await page(vu, 'анкета', `/quiz/${i + 1}`);
    await think();
    await req(vu, 'api', 'анкета: ответ шага', '/api/me/profile', { method: 'PUT', body: a });
  }
  await page(vu, 'анкета', '/quiz/review');
  await think();
  await req(vu, 'build', 'анкета → сборка капсулы', '/api/me/profile', { method: 'PUT', body: { complete: true } });
  await page(vu, 'капсула', '/capsule');
  await think();
  await req(vu, 'api', 'капсула: другой вариант', '/api/me/capsule?variant=2');
  await req(vu, 'api', 'капсула: замены вещи', '/api/me/capsule/1/top/alternatives');
  const cap = json(await req(vu, 'api', 'капсула: другой вариант', '/api/me/capsule?variant=1', { read: true }));
  const lines = (cap?.items ?? []).filter((i) => i.variant && !i.unavailable).map((i) => ({ variantId: i.variant.id, qty: 1, fromCapsule: true }));
  if (lines.length && alive(vu)) {
    await think();
    await req(vu, 'api', 'корзина: сохранить', '/api/cart', { method: 'PUT', body: { lines } });
    await page(vu, 'корзина', '/cart');
    await req(vu, 'api', 'корзина: проверка', '/api/cart/check', { method: 'POST', body: { lines } });
    await think();
    await page(vu, 'оформление', '/checkout');
    await req(vu, 'api', 'корзина: проверка', '/api/cart/check', { method: 'POST', body: { lines } });
    await req(vu, 'api', 'оформление: расчёт доставки', '/api/checkout/quote', { method: 'POST', body: { lines: lines.map(({ variantId, qty }) => ({ variantId, qty })), cityCode: 44 } });
  }
  await browse(vu, 2 + Math.floor(Math.random() * 3));
}

// ── Посетители и ступени ──────────────────────────────────────────────────────

let active = 0;
let toStop = 0;
let stopping = false;
let seq = 0;
let buyerSeq = 0;

/** Посетитель уходит на следующем шаге, если ступень уменьшила их число или тест кончился. */
function alive(vu) {
  if (vu.leaving) return false;
  if (stopping) vu.leaving = true;
  else if (toStop > 0) {
    toStop--;
    vu.leaving = true;
  }
  return !vu.leaving;
}

function fakeIp() {
  const n = seq++ % 131_072; // 198.18.0.0/15
  return `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}`;
}

/** Место посетителя: когда один уходит, на его место приходит новый — с пустым кэшем и другим адресом. */
async function slot() {
  active++;
  try {
    for (;;) {
      const vu = { cache: new Set(), links: [], ip: FAKE_IP ? fakeIp() : null, sid: null, leaving: false };
      if (USERS?.sessions?.length && chance(BUYERS)) vu.sid = USERS.sessions[buyerSeq++ % USERS.sessions.length];
      await (vu.sid ? buyer(vu) : guest(vu));
      if (!alive(vu)) break;
    }
  } finally {
    active--;
  }
}

async function discover() {
  const get = async (path) => {
    const r = await fetch(BASE + path, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  const tree = await get('/api/catalog/categories');
  const categories = tree.flatMap((c) => [c.slug, ...c.children.map((x) => x.slug)]);
  const products = [];
  for (let p = 1; p <= 10 && products.length < 300; p++) {
    const r = await get(`/api/catalog/products?page=${p}`);
    products.push(...r.items.map((i) => i.slug));
    if (p >= r.pages) break;
  }
  if (!products.length) throw new Error('На витрине нет товаров');
  return { categories, products };
}

function report(st) {
  const secs = (st.ended - st.started) / 1000;
  const rows = [...st.kinds.values()]
    .sort((a, b) => Object.keys(GROUPS).indexOf(a.group) - Object.keys(GROUPS).indexOf(b.group) || b.lat.length - a.lat.length)
    .map((r) => {
      const lat = r.lat.sort((a, b) => a - b);
      const p95 = pct(lat, 95);
      const fail = r.s5xx + r.net + (FAKE_IP ? r.s429 : 0);
      const ok = p95 <= GROUPS[r.group].limit && fail === 0;
      return { group: r.group, name: r.name, n: lat.length, p50: pct(lat, 50), p95, p99: pct(lat, 99), max: lat.at(-1) ?? 0, s4xx: r.s4xx, s429: r.s429, errors: fail, ok };
    });
  const pages = rows.filter((r) => r.group === 'page').reduce((s, r) => s + r.n, 0);
  console.log(`\n▸ ${st.users} посетителей, ${st.seconds} с: ${Math.round(st.requests / secs)} запросов/с, ${(pages / secs).toFixed(1)} страниц/с; задержка самого теста p99 ${Math.round(st.lag)} мс`);
  for (const r of rows) {
    const extra = [r.s429 && `429: ${r.s429}`, r.s4xx && `4xx: ${r.s4xx}`, r.errors && `ошибок: ${r.errors}`].filter(Boolean).join(' · ');
    const ms = (v) => String(Math.round(v)).padStart(5);
    console.log(`  ${r.ok ? '✓' : '✗'} ${`${GROUPS[r.group].label}: ${r.name}`.padEnd(44)} ${String(r.n).padStart(6)} · p50 ${ms(r.p50)} · p95 ${ms(r.p95)} · p99 ${ms(r.p99)} · max ${ms(r.max)} мс${extra ? ` · ${extra}` : ''}`);
  }
  return { users: st.users, seconds: st.seconds, rps: st.requests / secs, pagesPerSec: pages / secs, lagP99: st.lag, ok: rows.every((r) => r.ok), rows };
}

async function main() {
  D = await discover();
  console.log(`${BASE}: ${D.products.length} товаров, ${D.categories.length} разделов; покупателей с входом — ${USERS ? `${Math.round(BUYERS * 100)}%` : 'нет (LOAD_USERS не задан)'}; пауза ${THINK_MIN}–${THINK_MAX} с`);
  console.log(`Нормы p95: страница ≤ ${GROUPS.page.limit} мс, API ≤ ${GROUPS.api.limit} мс, сборка капсулы ≤ ${GROUPS.build.limit} мс, файлы ≤ ${GROUPS.asset.limit} мс; ошибок 5xx и обрывов — 0`);
  const lag = monitorEventLoopDelay({ resolution: 10 });
  const results = [];
  for (const [i, s] of STAGES.entries()) {
    stageNo = i;
    stats[i] = { ...s, kinds: new Map(), requests: 0, started: Date.now() };
    lag.reset();
    lag.enable();
    if (s.users < active) toStop = active - s.users;
    // Новые посетители приходят равномерно за первые 10 с ступени, а не все разом
    const add = s.users - active;
    const ramp = Math.min(10_000, (s.seconds * 1000) / 3);
    for (let k = 0; k < add; k++) setTimeout(() => void slot(), (ramp * k) / add);
    await sleep(s.seconds * 1000);
    stats[i].ended = Date.now();
    stats[i].lag = lag.percentile(99) / 1e6;
    lag.disable();
    results.push(report(stats[i]));
  }
  stopping = true;
  stageNo = -1;
  const best = results.filter((r) => r.ok).at(-1);
  console.log(`\n${best ? `Все нормы выполнены до ${best.users} одновременных посетителей включительно.` : 'Нормы не выполнены уже на первой ступени.'}`);
  if (errorSamples.size) console.log(`Примеры ошибок:\n${[...errorSamples].map(([k, p]) => `  ${k}: ${p}`).join('\n')}`);
  if (FAKE_IP && results.some((r) => r.rows.some((x) => x.s429))) {
    console.log('Ответы 429 при своём адресе у каждого посетителя: API не видит адрес покупателя (trust proxy) или тест идёт через Caddy — тогда LOAD_FAKE_IP=0.');
  }
  if (results.some((r) => r.lagP99 > 200)) console.log('Внимание: сам тест не успевал (задержка > 200 мс) — цифры завышены, запускайте с более мощной машины.');
  if (process.env.LOAD_REPORT) writeFileSync(process.env.LOAD_REPORT, JSON.stringify({ base: BASE, at: new Date().toISOString(), stages: results }, null, 2));
  // Посетители заканчивают текущий шаг; ждать их не нужно
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
