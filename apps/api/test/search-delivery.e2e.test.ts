import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { corrections, editDistance, expandSynonyms, looksPersonal } from '../src/storefront/search-text';
import { agent, bootApp, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('поиск: синонимы, опечатки, журнал пустых запросов; доставка на странице товара', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let supplierId: string;
  const anon = () => agent(app);

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
  });
  afterAll(async () => {
    await app.close();
  });

  async function product(title: string, category = 'kostyumy', variant: { weightG?: number; stock?: number } = {}) {
    const names: Record<string, string> = { obuv: 'Обувь', topy: 'Топы', aksessuary: 'Аксессуары' };
    const cat = await prisma.category.upsert({ where: { slug: category }, update: {}, create: { slug: category, name: names[category] ?? category } });
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const color = await prisma.color.findFirstOrThrow({ where: { name: 'Белый' } });
    return prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `p-${Math.random().toString(36).slice(2, 8)}`, gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(), description: 'Описание',
        variants: { create: [{ sku: `${title}-1`, size: 'M', colorId: color.id, price: 300000, stock: variant.stock ?? 3, weightG: variant.weightG ?? null }] },
      },
      include: { variants: true },
    });
  }
  const titles = async (q: string) => (await anon().get('/api/catalog/products').query({ q })).body.items.map((i: { title: string }) => i.title).sort();

  it('разбор строки: синонимы фразой, расстояние с перестановкой, исправления коротких слов, ПДн', () => {
    expect(expandSynonyms('медицинский халат')).toContain('халат');
    expect(expandSynonyms('скраб женский')).toContain('костюм женский');
    expect(editDistance('кастюм', 'костюм')).toBe(1);
    expect(editDistance('сбао', 'сабо')).toBe(1);
    const vocab = ['костюм', 'сабо', 'халат', 'топ', 'брюки'];
    expect(corrections('сабл', vocab)).toEqual(['сабо']);
    expect(corrections('топ', vocab)).toEqual([]); // и так в словаре
    expect(corrections('тап', vocab)).toEqual(['топ']);
    expect(corrections('кастю', vocab)).toEqual(['костюм']); // недописанное слово с опечаткой
    expect(corrections('кстюмм', vocab)).toEqual([]); // две опечатки в слове короче 7 букв — уже не исправляем
    expect(corrections('ортапедичиские', ['ортопедические'])).toEqual(['ортопедические']); // а в длинном — две можно
    expect(corrections('брюкии', vocab)).toEqual(['брюки']);
    expect(looksPersonal('ivan@mail.ru')).toBe(true);
    expect(looksPersonal('+7 999 123 45 67')).toBe(true);
    expect(looksPersonal('халат 52')).toBe(false);
  });

  it('синонимы: скраб, хирургичка → костюм; кроксы, обувь → сабо; колпак → шапочка; медицинский халат → халат', async () => {
    await product('Костюм «Хирург»');
    await product('Сабо ортопедические', 'obuv');
    await product('Халат «Классика»', 'halaty');
    await product('Шапочка хирургическая', 'aksessuary');
    expect(await titles('скраб')).toEqual(['Костюм «Хирург»']);
    // Набранное слово ищется нестрого: «хирургичка» похожа и на «хирургическую» шапочку — костюм в выдаче есть
    expect(await titles('хирургичка')).toContain('Костюм «Хирург»');
    expect(await titles('кроксы')).toEqual(['Сабо ортопедические']);
    expect(await titles('обувь медицинская')).toEqual(['Сабо ортопедические']);
    expect(await titles('колпак')).toEqual(['Шапочка хирургическая']);
    expect(await titles('медицинский халат')).toEqual(['Халат «Классика»']);
    // Все слова запроса должны совпасть: «халат классика» — один товар, а не все халаты и не всё с «классикой»
    expect(await titles('халат классика')).toEqual(['Халат «Классика»']);
    // Поиск по названию категории
    expect(await titles('халаты')).toEqual(['Халат «Классика»']);
    expect(await titles('аксессуары')).toEqual(['Шапочка хирургическая']);
  });

  it('опечатки в 1–2 символа, в том числе в коротких словах, и неверная раскладка', async () => {
    await product('Костюм «Хирург»');
    await product('Сабо ортопедические', 'obuv');
    await product('Топ «Актив»', 'topy');
    expect(await titles('сабл')).toEqual(['Сабо ортопедические']);
    expect(await titles('сбао')).toEqual(['Сабо ортопедические']);
    expect(await titles('тап')).toEqual(['Топ «Актив»']);
    expect(await titles('кастюм')).toEqual(['Костюм «Хирург»']);
    expect(await titles('костбм хирруг')).toEqual(['Костюм «Хирург»']);
    expect(await titles('ортапедичиские')).toEqual(['Сабо ортопедические']);
    expect(await titles('cf,j')).toEqual(['Сабо ортопедические']);
    // Без опечаток — ничего лишнего
    expect(await titles('костюм')).toEqual(['Костюм «Хирург»']);
  });

  it('пустая выдача: «Возможно, вы искали…», журнал без ПДн и раздел в админке', async () => {
    await product('Костюм «Хирург»');
    let res = (await anon().get('/api/catalog/products').query({ q: 'хурурк' })).body;
    expect(res.total).toBe(0);
    expect(res.didYouMean).toBe('хирург');
    res = (await anon().get('/api/catalog/products').query({ q: 'хирург' })).body;
    expect(res.total).toBe(1);
    expect(res.didYouMean).toBeNull();

    await anon().get('/api/catalog/products').query({ q: '  Пижама ' });
    await anon().get('/api/catalog/products').query({ q: 'пижама' });
    await anon().get('/api/catalog/products').query({ q: 'ПИЖАМА', size: 'XL' });
    await anon().get('/api/catalog/products').query({ q: 'ivan@mail.ru' });
    await anon().get('/api/catalog/products').query({ q: '89991234567' });
    // Нашлось, но отсеял фильтр — это не пустой запрос
    await anon().get('/api/catalog/products').query({ q: 'костюм', size: 'XXXL' });
    // Подсказки по мере ввода в журнал не пишутся
    await anon().get('/api/catalog/suggest').query({ q: 'пиж' });

    const rows = await prisma.searchEmptyQuery.findMany({ orderBy: { query: 'asc' } });
    expect(rows.map((r) => [r.query, r.count])).toEqual([['пижама', 3], ['хурурк', 1]]);
    expect(Object.keys(rows[0]).sort()).toEqual(['count', 'firstAt', 'lastAt', 'query']);

    // Админка: область «Справочники и витрина»; покупателю и гостю — нет
    const list = await admin.get('/api/admin/search/empty');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items[0]).toMatchObject({ query: 'пижама', count: 3 });
    expect(list.body.items[0].lastAt).toBeTruthy();
    expect((await admin.get('/api/admin/search/empty').query({ q: 'ху', limit: 1 })).body.items.map((i: { query: string }) => i.query)).toEqual(['хурурк']);
    await prisma.searchEmptyQuery.update({ where: { query: 'хурурк' }, data: { lastAt: new Date(Date.now() - 40 * 86400_000) } });
    expect((await admin.get('/api/admin/search/empty').query({ days: 30 })).body.total).toBe(1);
    expect((await admin.get('/api/admin/search/empty').query({ days: 60 })).body.total).toBe(2);
    expect((await anon().get('/api/admin/search/empty')).status).toBe(401);
    const buyer = await makeUser(app, 'b@example.ru');
    expect((await buyer.get('/api/admin/search/empty')).status).toBe(403);
  });

  it('доставка на странице товара: город по умолчанию, выбранный, из адреса; вес варианта, срок отгрузки, кэш', async () => {
    await prisma.supplier.update({ where: { id: supplierId }, data: { shipDays: 2 } });
    const p = await product('Костюм «Хирург»', 'kostyumy', { weightG: 2500 });
    const url = `/api/catalog/products/${p.slug}/delivery`;
    // Гость без выбора — Москва; офлайн-СДЭК: Москва → Москва 200 ₽ + 40 ₽ за каждый кг сверх первого (2,5 кг → 3 кг)
    let r = (await anon().get(url)).body;
    expect(r.city).toEqual({ code: 44, name: 'Москва', source: 'default' });
    expect(r.from).toBe('Москва');
    expect(r.pvz).toEqual({ price: 28000, periodMin: 3, periodMax: 4 });
    expect(r.courier).toEqual({ price: 42500, periodMin: 3, periodMax: 4 });
    expect([r.periodMin, r.periodMax]).toEqual([3, 4]);

    // Запомненный в браузере город
    r = (await anon().get(url).query({ cityCode: 270, city: 'Новосибирск', variantId: p.variants[0].id })).body;
    expect(r.city).toEqual({ code: 270, name: 'Новосибирск', source: 'stored' });
    expect(r.pvz.periodMin).toBe(9 + 2);

    // Вошедший с адресом — город адреса, если в карточке не выбран другой
    const buyer = await makeUser(app, 'buyer@example.ru');
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'buyer@example.ru' } });
    await prisma.address.create({ data: { userId: u.id, type: 'pvz', cityCode: 424, city: 'Казань', pvzCode: '424-PVZ1', pvzAddress: 'ул. Ленина, 12' } });
    r = (await buyer.get(url).query({ cityCode: 270, city: 'Новосибирск' })).body;
    expect(r.city).toMatchObject({ code: 424, name: 'Казань', source: 'address' });
    r = (await buyer.get(url).query({ cityCode: 270, city: 'Новосибирск', picked: 1 })).body;
    expect(r.city.source).toBe('picked');

    // Кэш на час по (склад, город, вес)
    const redis = app.get(RedisService).client;
    const keys = await redis.keys('dlv:*:estimate:44:44:2500');
    expect(keys).toHaveLength(1);
    const ttl = await redis.ttl(keys[0]);
    expect(ttl).toBeGreaterThan(3500);

    // Склад не указан — без расчёта, но не ошибка
    await prisma.supplier.update({ where: { id: supplierId }, data: { cdekCityCode: null } });
    r = (await anon().get(url)).body;
    expect(r.pvz).toBeNull();
    expect((await anon().get('/api/catalog/products/net-takogo/delivery')).status).toBe(404);
  });

  it('доставка: лимит частоты по IP', async () => {
    const p = await product('Костюм «Хирург»');
    const a = anon();
    for (let i = 0; i < 120; i++) await a.get(`/api/catalog/products/${p.slug}/delivery`).expect(200);
    expect((await a.get(`/api/catalog/products/${p.slug}/delivery`)).status).toBe(429);
  });

  it('публичный конфиг: без METRIKA_ID счётчика нет', async () => {
    expect((await anon().get('/api/public-config')).body).toEqual({ metrikaId: null });
  });
});
