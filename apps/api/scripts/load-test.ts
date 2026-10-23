/**
 * Нагрузочный тест витрины (ТЗ §11: API каталога p95 ≤ 300 мс при 200 одновременных пользователях).
 * 50 соединений без пауз — это заметно жёстче, чем 200 живых покупателей с паузами между кликами.
 * Запуск: LOAD_URL=http://localhost:4200 pnpm --filter @aesculap/api load:test
 */
import autocannon from 'autocannon';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.LOAD_URL ?? 'http://localhost:4200';
const SECONDS = Number(process.env.LOAD_SECONDS ?? 15);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 50);
/** Общий темп, запросов/с: 200 покупателей с паузой ~3 с между кликами ≈ 70 rps. 0 — без ограничения (стресс). */
const RATE = Number(process.env.LOAD_RATE ?? 0);

type Scenario = { name: string; requests: autocannon.Request[] };

async function scenarios(): Promise<Scenario[]> {
  const prisma = new PrismaClient();
  const [products, colors, variants] = await Promise.all([
    prisma.product.findMany({ select: { slug: true }, take: 200, orderBy: { publishedAt: 'desc' } }),
    prisma.color.findMany(),
    prisma.productVariant.findMany({ where: { stock: { gt: 0 } }, select: { id: true }, take: 10 }),
  ]);
  await prisma.$disconnect();
  const cart = JSON.stringify({ lines: variants.map((v) => ({ variantId: v.id, qty: 1 })) });
  const get = (path: string): autocannon.Request => ({ method: 'GET', path });
  // Разные страницы, фильтры и запросы — чтобы мерить расчёт выдачи, а не только кэш одного адреса.
  const sorts = ['', 'price_asc', 'price_desc'];
  const pages = Array.from({ length: 20 }, (_, i) => i + 1).flatMap((page) => sorts.map((sort) => get(`/api/catalog/products?page=${page}${sort ? `&sort=${sort}` : ''}`)));
  const sizes = ['XS', 'S', 'M', 'L', 'XL'];
  const filters = Array.from({ length: 120 }, (_, i) =>
    get(`/api/catalog/products?category=${['kostyumy', 'halaty', 'topy', 'bryuki'][i % 4]}&size=${sizes[i % 5]}&color=${colors[i % colors.length].id}&priceFrom=${1500 + (i % 6) * 500}&priceTo=${4000 + (i % 5) * 1000}&sort=${sorts[i % 3]}`),
  );
  const words = ['костюм', 'халат', 'топ', 'брюки', 'блуза', 'сабо', 'комфорт', 'хирург', 'классика', 'премиум', 'rjcnev', 'хлат', 'актив', 'туника', 'жилет'];
  const searches = words.flatMap((w) => [get(`/api/catalog/products?q=${encodeURIComponent(w)}`), get(`/api/catalog/products?q=${encodeURIComponent(w)}&page=2`)]);
  return [
    { name: 'Каталог: 20 страниц × 3 сортировки', requests: pages },
    { name: 'Фильтры: 120 комбинаций', requests: filters },
    { name: 'Поиск: 30 запросов (с опечатками)', requests: searches },
    { name: 'Подсказки поиска', requests: [get(`/api/catalog/suggest?q=${encodeURIComponent('хала')}`)] },
    { name: 'Карточка товара (200 разных)', requests: products.map((p) => get(`/api/catalog/products/${p.slug}`)) },
    { name: 'Главная', requests: [get('/api/catalog/home')] },
    { name: 'Проверка корзины (10 позиций)', requests: [{ method: 'POST', path: '/api/cart/check', headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' }, body: cart }] },
  ];
}

async function main() {
  const rows: string[] = [];
  const only = process.env.LOAD_ONLY;
  for (const s of (await scenarios()).filter((x) => !only || x.name.toLowerCase().includes(only.toLowerCase()))) {
    const r = await autocannon({ url: BASE, connections: CONNECTIONS, duration: SECONDS, requests: s.requests, ...(RATE ? { overallRate: RATE } : {}) });
    const errors = r.errors + r.timeouts + r.non2xx;
    const ok = r.latency.p97_5 <= 300 && errors === 0;
    rows.push(`${ok ? '✓' : '✗'} ${s.name.padEnd(34)} ${String(Math.round(r.requests.average)).padStart(5)} rps · p50 ${r.latency.p50} мс · p90 ${r.latency.p90} мс · p97.5 ${r.latency.p97_5} мс · ошибок ${errors}`);
    console.log(rows.at(-1));
  }
  console.log(`\n${CONNECTIONS} соединений${RATE ? `, темп ${RATE} запросов/с` : ' без пауз (стресс)'} × ${SECONDS} с на сценарий. Критерий: p97.5 ≤ 300 мс (строже p95) и без ошибок.`);
}

void main();
