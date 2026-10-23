import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { swapLayout } from '../src/storefront/catalog.service';
import { ORIGIN, agent, bootApp, jpeg, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

describe('витрина и журнал', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let sup: Agent;
  let supplierId: string;
  const anon = () => agent(app);

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ agent: sup, supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
  });
  afterAll(async () => {
    await app.close();
  });

  /** Опубликованный товар напрямую в БД — витрине неважно, как он туда попал. */
  async function product(title: string, opts: { category?: string; gender?: 'female' | 'male' | 'unisex'; status?: 'published' | 'draft'; variants: { size: string; color: string; price: number; oldPrice?: number; stock: number }[]; publishedAt?: Date }) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: opts.category ?? 'kostyumy' } });
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const colors = await prisma.color.findMany();
    const p = await prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `${title.replace(/\W+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`,
        gender: opts.gender ?? 'unisex', moderationStatus: opts.status ?? 'published', publishedAt: opts.publishedAt ?? new Date(), description: 'Описание',
        variants: { create: opts.variants.map((v, i) => ({ sku: `${title}-${i}`, size: v.size, colorId: colors.find((c) => c.name === v.color)!.id, price: v.price * 100, oldPrice: v.oldPrice ? v.oldPrice * 100 : null, stock: v.stock })) },
      },
    });
    return p;
  }

  it('видимость: только опубликованные, в наличии и с подключёнными выплатами', async () => {
    await product('Костюм видимый', { variants: [{ size: 'M', color: 'Белый', price: 4590, stock: 3 }] });
    await product('Костюм черновик', { status: 'draft', variants: [{ size: 'M', color: 'Белый', price: 4590, stock: 3 }] });
    const zero = await product('Костюм без остатка', { variants: [{ size: 'M', color: 'Белый', price: 4590, stock: 0 }] });
    let list = (await anon().get('/api/catalog/products')).body;
    expect(list.items.map((i: { title: string }) => i.title)).toEqual(['Костюм видимый']);
    expect((await anon().get(`/api/catalog/products/${zero.slug}`)).status).toBe(404);

    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'not_connected' } });
    list = (await anon().get('/api/catalog/products')).body;
    expect(list.total).toBe(0);
  });

  it('кэш каталога: снятый с витрины товар пропадает сразу, остальное — свежие карточки', async () => {
    process.env.CATALOG_CACHE = 'on';
    try {
      const p = await product('Костюм кэш', { variants: [{ size: 'M', color: 'Белый', price: 4590, stock: 3 }] });
      await product('Халат кэш', { variants: [{ size: 'M', color: 'Белый', price: 3000, stock: 3 }] });
      expect((await anon().get('/api/catalog/products')).body.total).toBe(2);
      // Снятие с витрины через кабинет сбрасывает версию кэша
      await sup.post(`/api/supplier/products/${p.id}/hide`).set('Origin', ORIGIN).expect(200);
      let list = (await anon().get('/api/catalog/products')).body;
      expect(list.total).toBe(1);
      // Остаток обнулился в обход кабинета: порядок выдачи из кэша, но карточка без наличия не показывается
      await prisma.productVariant.updateMany({ where: { product: { title: 'Халат кэш' } }, data: { stock: 0 } });
      list = (await anon().get('/api/catalog/products')).body;
      expect(list.items).toHaveLength(0);
    } finally {
      process.env.CATALOG_CACHE = 'off';
    }
  });

  it('фото по цвету: карточка, корзина и назначение цвета поставщиком', async () => {
    const p = await product('Костюм двухцветный', {
      variants: [
        { size: 'M', color: 'Бирюзовый', price: 5000, stock: 2 },
        { size: 'M', color: 'Белый', price: 4000, stock: 2 },
      ],
    });
    const [teal, white] = await Promise.all([prisma.color.findUniqueOrThrow({ where: { name: 'Бирюзовый' } }), prisma.color.findUniqueOrThrow({ where: { name: 'Белый' } })]);
    const shot = (key: string, colorId: string | null, position: number) => ({ productId: p.id, type: 'photo' as const, storageKey: `public/products/${p.id}/${key}.webp`, colorId, position, isMain: position === 0, approved: true });
    await prisma.productMedia.createMany({ data: [shot('teal', teal.id, 0), shot('white', white.id, 1), shot('common', null, 2)] });

    // Карточка — по самому дешёвому варианту (белый) и его фото
    const card = (await anon().get('/api/catalog/products')).body.items.find((i: { title: string }) => i.title === 'Костюм двухцветный');
    expect(card.images[0]).toContain('white_thumb');
    const details = (await anon().get(`/api/catalog/products/${p.slug}`)).body;
    expect(details.media.map((m: { colorId: string | null }) => m.colorId)).toEqual([teal.id, white.id, null]);
    // Корзина — фото цвета варианта
    const tealVariant = await prisma.productVariant.findFirstOrThrow({ where: { productId: p.id, colorId: teal.id } });
    const check = (await anon().post('/api/cart/check').set('Origin', ORIGIN).send({ lines: [{ variantId: tealVariant.id, qty: 1 }] })).body;
    expect(check.items[0].product.image).toContain('teal_thumb');

    // Поставщик переназначает цвет: только из цветов вариантов товара
    const common = await prisma.productMedia.findFirstOrThrow({ where: { productId: p.id, colorId: null } });
    const other = await prisma.color.create({ data: { name: 'Графит-тест', hex: '#333333', colorFamily: 'dark' } });
    expect((await sup.put(`/api/supplier/products/${p.id}/media/${common.id}/color`).set('Origin', ORIGIN).send({ colorId: other.id })).status).toBe(400);
    const res = await sup.put(`/api/supplier/products/${p.id}/media/${common.id}/color`).set('Origin', ORIGIN).send({ colorId: teal.id }).expect(200);
    expect(res.body.media.find((m: { id: string }) => m.id === common.id).colorId).toBe(teal.id);
    await prisma.color.delete({ where: { id: other.id } });
  });

  it('витрина: хиты по продажам, закреплённые хиты, «Капсула недели», тексты главной; доступ редактора', async () => {
    const a1 = await product('Хит продаж', { variants: [{ size: 'M', color: 'Белый', price: 3000, stock: 9 }], publishedAt: new Date(Date.now() - 86400000) });
    const b1 = await product('Новинка', { variants: [{ size: 'M', color: 'Белый', price: 3000, stock: 9 }] });
    // Продажа за неделю: оплаченное отправление с позицией «Хита продаж»
    const buyer = await prisma.user.create({ data: { email: 'b@example.ru', passwordHash: 'x' } });
    const v = await prisma.productVariant.findFirstOrThrow({ where: { productId: a1.id } });
    await prisma.order.create({
      data: {
        number: '700001', userId: buyer.id, status: 'paid', paymentStatus: 'succeeded', goodsTotal: 1, deliveryTotal: 0, total: 1, recipientName: 'Б', recipientPhone: '+79990000000', recipientEmail: 'b@example.ru', expiresAt: new Date(),
        shipments: { create: { no: 1, supplierId, status: 'new', paidAt: new Date(), deliveryType: 'pvz', tariffCode: 136, cityCode: 44, address: 'М', deliveryPrice: 0, periodMin: 1, periodMax: 2, goodsTotal: 1, commissionBp: 1000, commission: 0,
          items: { create: { variantId: v.id, title: 'Хит продаж', brand: 'Б', sku: 'S', size: 'M', color: 'Белый', price: 1, qty: 5 } } } },
      },
    });
    let home = (await anon().get('/api/catalog/home')).body;
    expect(home.hits.map((h: { title: string }) => h.title).slice(0, 2)).toEqual(['Хит продаж', 'Новинка']);
    expect(home.hero.title).toMatch(/Рабочая капсула/);
    expect(home.capsuleOfWeek).toBeNull();

    const cur = (await admin.get('/api/admin/storefront')).body.settings;
    const next = { ...cur, hero: { ...cur.hero, title: 'Форма для всей смены', accent: 'смены' }, hitsProductIds: [b1.id, a1.id], capsuleOfWeek: { title: 'Капсула стоматолога', text: 'Пять вещей', productIds: [a1.id, b1.id] } };
    await admin.put('/api/admin/storefront').set('Origin', ORIGIN).send(next).expect(200);
    home = (await anon().get('/api/catalog/home')).body;
    expect(home.hero.title).toBe('Форма для всей смены');
    expect(home.hits.slice(0, 2).map((h: { title: string }) => h.title)).toEqual(['Новинка', 'Хит продаж']);
    expect(home.capsuleOfWeek).toMatchObject({ title: 'Капсула стоматолога' });
    expect(home.capsuleOfWeek.items).toHaveLength(2);
    expect((await sup.get('/api/admin/storefront')).status).toBe(403);
  });

  it('фильтры по варианту, полу, цене, распродаже; цена карточки — от подходящего варианта', async () => {
    await product('Костюм «Хирург»', { variants: [{ size: 'M', color: 'Бирюзовый', price: 4590, oldPrice: 5290, stock: 3 }, { size: 'XL', color: 'Белый', price: 4990, stock: 1 }] });
    await product('Халат «Классика»', { category: 'halaty', gender: 'female', variants: [{ size: 'S', color: 'Белый', price: 3490, stock: 5 }] });

    const white = (await anon().get('/api/catalog/products').query({ color: (await prisma.color.findFirstOrThrow({ where: { name: 'Белый' } })).id, sort: 'price_asc' })).body;
    expect(white.items.map((i: { title: string; price: number }) => [i.title, i.price])).toEqual([['Халат «Классика»', 349000], ['Костюм «Хирург»', 499000]]);

    expect((await anon().get('/api/catalog/products').query({ size: 'M' })).body.total).toBe(1);
    expect((await anon().get('/api/catalog/products').query({ gender: 'female' })).body.items[0].title).toBe('Халат «Классика»');
    expect((await anon().get('/api/catalog/products').query({ priceFrom: 4000, priceTo: 4700 })).body.items.map((i: { title: string }) => i.title)).toEqual(['Костюм «Хирург»']);
    const sale = (await anon().get('/api/catalog/products').query({ sale: 1 })).body;
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0]).toMatchObject({ price: 459000, oldPrice: 529000, sale: true });

    const cat = (await anon().get('/api/catalog/products').query({ category: 'halaty' })).body;
    expect(cat.category.name).toBe('Халаты');
    expect(cat.total).toBe(1);
    expect((await anon().get('/api/catalog/products').query({ category: 'net-takoy' })).status).toBe(404);
  });

  it('фасеты со счётчиками и сортировка по новизне, пагинация', async () => {
    for (let i = 0; i < 35; i++) await product(`Топ ${i}`, { publishedAt: new Date(Date.now() - i * 60_000), variants: [{ size: i % 2 ? 'S' : 'M', color: 'Белый', price: 1000 + i, stock: 1 }] });
    const page1 = (await anon().get('/api/catalog/products')).body;
    expect(page1).toMatchObject({ total: 35, pages: 2, page: 1 });
    expect(page1.items[0].title).toBe('Топ 0');
    expect((await anon().get('/api/catalog/products').query({ page: 2 })).body.items).toHaveLength(5);
    expect(page1.facets.sizes).toEqual([{ value: 'S', count: 17 }, { value: 'M', count: 18 }]);
    expect(page1.facets.price).toEqual({ min: 100000, max: 103400 });
  });

  it('поиск: опечатка, неверная раскладка, бренд; подсказки', async () => {
    await product('Костюм «Хирург»', { variants: [{ size: 'M', color: 'Белый', price: 4590, stock: 3 }] });
    await product('Сабо ортопедические', { category: 'halaty', variants: [{ size: '38', color: 'Белый', price: 3990, stock: 3 }] });
    const titles = async (q: string) => (await anon().get('/api/catalog/products').query({ q })).body.items.map((i: { title: string }) => i.title);
    expect(await titles('костюм')).toEqual(['Костюм «Хирург»']);
    expect(await titles('кастюм')).toEqual(['Костюм «Хирург»']);
    expect(swapLayout('rjcn.v')).toBe('костюм');
    expect(await titles('rjcn.v')).toEqual(['Костюм «Хирург»']);
    expect(await titles('cf,j')).toEqual(['Сабо ортопедические']);
    expect((await titles('медтекс')).length).toBe(2);
    const s = (await anon().get('/api/catalog/suggest').query({ q: 'хал' })).body;
    expect(s.categories.map((c: { name: string }) => c.name)).toEqual(['Халаты']);
    expect((await anon().get('/api/catalog/suggest').query({ q: 'с' })).body.products).toEqual([]);
  });

  it('страница товара: только проверенные медиа, сведения о продавце, таблица размеров по умолчанию', async () => {
    const p = await product('Костюм «Хирург»', { variants: [{ size: 'L', color: 'Белый', price: 4590, stock: 3 }, { size: 'M', color: 'Белый', price: 4590, stock: 0 }] });
    await prisma.productMedia.createMany({ data: [{ productId: p.id, type: 'photo', storageKey: `public/products/${p.id}/a.webp`, approved: true, isMain: true }, { productId: p.id, type: 'photo', storageKey: `public/products/${p.id}/b.webp`, approved: false }] });
    const res = (await anon().get(`/api/catalog/products/${p.slug}`)).body;
    expect(res.media).toHaveLength(1);
    expect(res.variants.map((v: { size: string }) => v.size)).toEqual(['M', 'L']);
    expect(res.seller).toMatchObject({ inn: '7707083893', city: 'Москва' });
    expect(res.sizeChart.clothes.rows[2]).toEqual(['46', 'M', '92', '74', '98']);
  });

  it('журнал: статья поставщика проходит модерацию, HTML очищается, товары и страница товара связаны', async () => {
    const p = await product('Костюм «Хирург»', { variants: [{ size: 'M', color: 'Белый', price: 4590, stock: 3 }] });
    const cover = await sup.post('/api/supplier/content/image').set('Origin', ORIGIN).attach('file', await jpeg(2), { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(cover.status).toBe(201);
    const body = `<h2>Ткань</h2><p onclick="x()">Смесовая ткань ${'держит форму '.repeat(20)}</p><script>alert(1)</script><img src="https://evil/x.png"><a href="javascript:alert(1)">ссылка</a>`;
    const created = await sup.post('/api/supplier/content/articles').set('Origin', ORIGIN).send({ title: 'Как выбрать форму для долгой смены', lead: 'Советы', coverKey: cover.body.key, body, productIds: [p.id] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.body).not.toMatch(/script|onclick|evil|javascript/);
    expect(created.body.body).toMatch(/<h2>Ткань<\/h2>/);

    expect((await anon().get('/api/journal')).body).toEqual([]);
    expect((await sup.post(`/api/supplier/content/articles/${created.body.id}/submit`).set('Origin', ORIGIN)).status).toBe(204);
    const queue = (await admin.get('/api/admin/content')).body;
    expect(queue).toMatchObject([{ kind: 'article', id: created.body.id }]);
    expect((await admin.post(`/api/admin/content/article/${created.body.id}/approve`).set('Origin', ORIGIN)).status).toBe(204);

    const journal = (await anon().get('/api/journal')).body;
    expect(journal).toMatchObject([{ kind: 'article', title: 'Как выбрать форму для долгой смены', author: `ООО owner@sup.ru` }]);
    const article = (await anon().get(`/api/journal/articles/${journal[0].slug}`)).body;
    expect(article.products.map((x: { title: string }) => x.title)).toEqual(['Костюм «Хирург»']);
    expect((await anon().get(`/api/catalog/products/${p.slug}`)).body.articles).toHaveLength(1);

    // Чужой товар привязать нельзя
    const other = await makeSupplier(app, admin, 'b@sup.ru', '500100732259');
    const bad = await other.agent.post('/api/supplier/content/collections').set('Origin', ORIGIN).send({ title: 'Подборка', productIds: [p.id] });
    expect(bad.status).toBe(400);
  });

  it('подборка требует 3 товара и обложку; sitemap отдаёт опубликованное', async () => {
    const ps = [];
    for (const i of [1, 2, 3]) ps.push(await product(`Брюки ${i}`, { variants: [{ size: 'M', color: 'Белый', price: 2000, stock: 1 }] }));
    const c = await sup.post('/api/supplier/content/collections').set('Origin', ORIGIN).send({ title: 'Форма для стоматологии', productIds: ps.slice(0, 2).map((x) => x.id) });
    expect((await sup.post(`/api/supplier/content/collections/${c.body.id}/submit`).set('Origin', ORIGIN)).body.message).toMatch(/3 товара/);
    const sm = (await anon().get('/api/catalog/sitemap')).body;
    expect(sm.products).toHaveLength(3);
    expect(sm.categories.length).toBeGreaterThan(0);
  });
});
