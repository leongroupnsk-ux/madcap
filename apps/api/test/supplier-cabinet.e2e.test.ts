import type { INestApplication } from '@nestjs/common';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProductStatsService } from '../src/analytics/product-stats.service';
import { sha256 } from '../src/common/crypto';
import { pdfPageCount } from '../src/common/pdf';
import { PrismaService } from '../src/common/prisma.service';
import { config } from '../src/config';
import { ImportService } from '../src/import/import.service';
import { ORIGIN, agent, bootApp, dictionaries, fileServer, mails, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

/** Тело ответа-файла (PDF) как Buffer */
const binary = (r: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Текст PDF через ToUnicode: собираем все строки <hex> из потоков и переводим глифы обратно в символы */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams: string[] = [];
  const re = /stream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('\nendstream', start);
    try {
      streams.push(inflateSync(pdf.subarray(start, end)).toString('latin1'));
    } catch {
      /* шрифт и прочие двоичные потоки */
    }
  }
  const map = new Map<string, string>();
  for (const s of streams) for (const [, g, u] of s.matchAll(/<([0-9a-f]{4})> <([0-9a-f]{4})>/g)) map.set(g, String.fromCharCode(parseInt(u, 16)));
  return streams
    .flatMap((s) => [...s.matchAll(/<([0-9a-f]+)> Tj/g)].map(([, hex]) => hex.match(/.{4}/g)!.map((g) => map.get(g) ?? '?').join('')))
    .join('\n');
}

describe('кабинет поставщика: автоимпорт, партнёрский API, аналитика, массовая печать', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let sup: Agent;
  let supplierId: string;
  let server: Awaited<ReturnType<typeof fileServer>>;
  let feed = '';
  const routes: Record<string, () => Promise<{ type: string; body: Buffer | string }>> = {
    '/feed.xml': async () => ({ type: 'application/xml', body: feed }),
  };

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    server = await fileServer(routes);
  });
  afterAll(async () => {
    await server.close();
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    await prisma.supplierFeedSchedule.deleteMany();
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ agent: sup, supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
  });

  /** Сотрудник поставщика с ролью (без приглашения — сразу в базе) */
  async function member(email: string, role: 'catalog' | 'warehouse', sid = supplierId) {
    const a = await makeUser(app, email);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.supplierMember.create({ data: { supplierId: sid, userId: u.id, role } });
    return a;
  }

  /** Товар через кабинет, опубликован: варианты K-M (остаток 3) и K-L (0) */
  async function product(a: Agent = sup, title = 'Костюм «Хирург»', skus: [string, string] = ['K-M', 'K-L']) {
    const d = await dictionaries(a);
    const brand = await a.post('/api/supplier/brands').set('Origin', ORIGIN).send({ name: `МедТекс ${Math.random().toString(36).slice(2, 6)}` });
    const variant = (sku: string, size: string, stock: number) => ({ sku, size, heightRange: '', colorId: d.colors[0].id, price: 4590, oldPrice: null, stock, weightG: 600, lengthMm: 300, widthMm: 250, heightMm: 50 });
    const res = await a.post('/api/supplier/products').set('Origin', ORIGIN).send({
      title, brandId: brand.body.id, categoryId: d.categories[0].id, gender: 'unisex', fabric: '', treatment: '', washing: '', description: 'Скраб',
      specialtyIds: [], variants: [variant(skus[0], 'M', 3), variant(skus[1], 'L', 0)], media: { order: [], mainId: null },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await prisma.product.update({ where: { id: res.body.id }, data: { moderationStatus: 'published', publishedAt: new Date() } });
    return prisma.product.findUniqueOrThrow({ where: { id: res.body.id }, include: { variants: { orderBy: { size: 'desc' } } } });
  }

  /** Оплаченное отправление поставщика напрямую в базе */
  let orderNo = 500000;
  async function shipment(sid: string, opts: { status?: 'new' | 'packed' | 'handed_over' | 'delivered' | 'cancelled'; paidAt?: Date; items?: { variantId?: string; title: string; sku: string; price: number; qty: number; returnedQty?: number }[]; cdek?: boolean } = {}) {
    const buyer = await prisma.user.upsert({ where: { email: 'buyer@example.ru' }, update: {}, create: { email: 'buyer@example.ru', passwordHash: 'x' } });
    const items = opts.items ?? [{ title: 'Костюм', sku: 'K-M', price: 459000, qty: 1 }];
    const goods = items.reduce((s, i) => s + i.price * i.qty, 0);
    const paidAt = opts.paidAt ?? new Date();
    const order = await prisma.order.create({
      data: {
        number: String(++orderNo), userId: buyer.id, status: 'paid', paymentStatus: 'succeeded', goodsTotal: goods, deliveryTotal: 30000, total: goods + 30000,
        recipientName: 'Анна Тестова', recipientPhone: '+79991234567', recipientEmail: 'buyer@example.ru', expiresAt: new Date(), paidAt,
      },
    });
    return prisma.shipment.create({
      data: {
        orderId: order.id, supplierId: sid, no: 1, status: opts.status ?? 'new', deliveryType: 'pvz', tariffCode: 136, cityCode: 137, address: 'Санкт-Петербург, ул. Ленина, 12', pvzCode: 'SPB1',
        deliveryPrice: 30000, periodMin: 2, periodMax: 4, goodsTotal: goods, commissionBp: 1000, commission: Math.round(goods / 10), paidAt,
        cdekUuid: opts.cdek ? `fake-${orderNo}` : null, trackNo: opts.cdek ? `1${orderNo}` : null,
        items: { create: items.map((i) => ({ variantId: i.variantId, title: i.title, brand: 'МедТекс', sku: i.sku, size: 'M', color: 'Бирюзовый', price: i.price, qty: i.qty, returnedQty: i.returnedQty ?? 0 })) },
      },
    });
  }

  // ─── импорт по расписанию ────────────────────────────────────────────

  describe('YML-фид по расписанию', () => {
    const offer = (id: string, count: number, price: number) =>
      `<offer id="${id}" group_id="G1" available="true"><name>Халат «Доктор»</name><vendor>Форма+</vendor><price>${price}</price><categoryId>2</categoryId>` +
      `<description>Халат</description><param name="Размер">M</param><param name="Цвет">Белый</param><count>${count}</count><weight>0.7</weight><dimensions>30/25/5</dimensions></offer>`;
    const doc = (offers: string) => `<?xml version="1.0"?><yml_catalog><shop><categories><category id="2">Халаты</category></categories><offers>${offers}</offers></shop></yml_catalog>`;
    const imports = () => app.get(ImportService);
    const HOUR = 3600_000;

    it('частота 1/6/24 ч: синк только когда пора; изменения остатка и цены применяются без ручного шага', async () => {
      feed = doc(offer('H-M', 4, 6290));
      const set = await sup.put('/api/supplier/import/feed').set('Origin', ORIGIN).send({ url: `${server.base}/feed.xml` });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      let v = await prisma.productVariant.findFirstOrThrow({ where: { sku: 'H-M' } });
      expect(v).toMatchObject({ stock: 4, price: 629000 });

      // Частоты, кроме 1/6/24, нельзя
      expect((await sup.put('/api/supplier/import/feed/schedule').set('Origin', ORIGIN).send({ everyHours: 2, paused: false })).status).toBe(400);
      const sch = await sup.put('/api/supplier/import/feed/schedule').set('Origin', ORIGIN).send({ everyHours: 1, paused: false });
      expect(sch.body).toMatchObject({ everyHours: 1, paused: false, failures: 0 });

      feed = doc(offer('H-M', 9, 5990));
      const t0 = (await prisma.supplierFeedSchedule.findUniqueOrThrow({ where: { supplierId } })).lastRunAt!.getTime();
      // Через 30 минут — рано (не чаще раза в час)
      expect(await imports().syncDueFeeds(new Date(t0 + 30 * 60_000))).toEqual([]);
      expect(await imports().syncDueFeeds(new Date(t0 + HOUR))).toEqual([supplierId]);
      v = await prisma.productVariant.findFirstOrThrow({ where: { sku: 'H-M' } });
      expect(v).toMatchObject({ stock: 9, price: 599000 });
      const jobs = await prisma.importJob.findMany({ where: { supplierId, source: 'yml' } });
      expect(jobs.every((j) => j.status === 'applied')).toBe(true);

      // 24 ч: через 7 часов — рано, через сутки — пора
      await sup.put('/api/supplier/import/feed/schedule').set('Origin', ORIGIN).send({ everyHours: 24, paused: false });
      const t1 = (await prisma.supplierFeedSchedule.findUniqueOrThrow({ where: { supplierId } })).lastRunAt!.getTime();
      expect(await imports().syncDueFeeds(new Date(t1 + 7 * HOUR))).toEqual([]);
      expect(await imports().syncDueFeeds(new Date(t1 + 24 * HOUR))).toEqual([supplierId]);

      // Пауза поставщиком — расписание фид не трогает
      const paused = await sup.put('/api/supplier/import/feed/schedule').set('Origin', ORIGIN).send({ everyHours: 24, paused: true });
      expect(paused.body).toMatchObject({ paused: true, pauseReason: 'manual', nextRunAt: null });
      expect(await imports().syncDueFeeds(new Date(t1 + 100 * HOUR))).toEqual([]);
      const state = await sup.get('/api/supplier/import/feed');
      expect(state.body).toMatchObject({ url: `${server.base}/feed.xml`, everyHours: 24, paused: true });
    });

    it('ошибки: уведомление в колокольчик на каждую, после 3 подряд — автопауза; включение сбрасывает счётчик', async () => {
      feed = doc(offer('H-M', 4, 6290));
      await sup.put('/api/supplier/import/feed').set('Origin', ORIGIN).send({ url: `${server.base}/feed.xml` });
      await sup.put('/api/supplier/import/feed/schedule').set('Origin', ORIGIN).send({ everyHours: 1, paused: false });
      const saved = routes['/feed.xml'];
      delete routes['/feed.xml']; // сервер поставщика отвечает 404
      try {
        let t = Date.now();
        for (let i = 1; i <= 3; i++) {
          t += 2 * HOUR;
          expect(await app.get(ImportService).syncDueFeeds(new Date(t))).toEqual([supplierId]);
          const sch = await prisma.supplierFeedSchedule.findUniqueOrThrow({ where: { supplierId } });
          expect(sch.failures).toBe(i);
          expect(Boolean(sch.pausedAt)).toBe(i === 3);
        }
        const last = await prisma.importJob.findFirstOrThrow({ where: { supplierId, source: 'yml' }, orderBy: { createdAt: 'desc' } });
        expect(last).toMatchObject({ status: 'failed' });
        expect(last.failReason).toMatch(/404/);
        const bell = await sup.get('/api/supplier/notifications');
        const titles = bell.body.items.map((n: { title: string }) => n.title);
        expect(titles.filter((x: string) => x === 'Синхронизация фида не удалась')).toHaveLength(2);
        expect(titles[0]).toBe('Синхронизация фида приостановлена');
        // На паузе по ошибкам расписание не запускает синк
        expect(await app.get(ImportService).syncDueFeeds(new Date(t + 10 * HOUR))).toEqual([]);
        expect((await sup.get('/api/supplier/import/feed')).body).toMatchObject({ paused: true, pauseReason: 'errors', failures: 3 });
      } finally {
        routes['/feed.xml'] = saved;
      }
      const resumed = await sup.put('/api/supplier/import/feed/schedule').set('Origin', ORIGIN).send({ everyHours: 1, paused: false });
      expect(resumed.body).toMatchObject({ paused: false, failures: 0, pauseReason: null });
    });
  });

  // ─── партнёрский API ─────────────────────────────────────────────────

  describe('партнёрский API', () => {
    const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
    const api = () => agent(app);
    async function newKey(name = '1С склад') {
      const res = await sup.post('/api/supplier/api-keys').set('Origin', ORIGIN).send({ name });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body as { key: string; item: { id: string; prefix: string } };
    }

    it('ключ: показывается один раз, в базе — хэш; создать и отозвать может только владелец; отозванный не работает', async () => {
      const { key, item } = await newKey();
      expect(key).toMatch(/^ak_[A-Za-z0-9_-]{32}$/);
      const row = await prisma.partnerApiKey.findUniqueOrThrow({ where: { id: item.id } });
      expect(row.hash).toBe(sha256(key));
      expect(JSON.stringify(row)).not.toContain(key);
      expect(item.prefix).toBe(key.slice(0, 7));
      const list = await sup.get('/api/supplier/api-keys');
      expect(JSON.stringify(list.body)).not.toContain(key);
      expect(list.body).toHaveLength(1);

      // Сотрудники с ролями «Каталог» и «Склад» ключами не управляют
      const catalog = await member('catalog@sup.ru', 'catalog');
      expect((await catalog.post('/api/supplier/api-keys').set('Origin', ORIGIN).send({ name: 'x' })).status).toBe(403);
      expect((await catalog.get('/api/supplier/api-keys')).status).toBe(403);
      const wh = await member('wh@sup.ru', 'warehouse');
      expect((await wh.delete(`/api/supplier/api-keys/${item.id}`).set('Origin', ORIGIN)).status).toBe(403);

      // Без ключа и с чужим ключом — 401
      expect((await api().get('/api/partner/v1/orders')).status).toBe(401);
      expect((await api().get('/api/partner/v1/orders').set(bearer('ak_' + 'x'.repeat(32)))).status).toBe(401);
      expect((await api().get('/api/partner/v1/orders').set(bearer(key))).status).toBe(200);

      const revoked = await sup.delete(`/api/supplier/api-keys/${item.id}`).set('Origin', ORIGIN);
      expect(revoked.status).toBe(200);
      expect(revoked.body[0].revokedAt).toBeTruthy();
      expect((await api().get('/api/partner/v1/orders').set(bearer(key))).status).toBe(401);
      const audit = await prisma.auditLog.findMany({ where: { entity: 'partner_api_key', entityId: item.id } });
      expect(audit.map((a) => a.action).sort()).toEqual(['partner_key.create', 'partner_key.revoke']);
    });

    it('остатки и цены по SKU пачкой: применяются сразу, пополнение с нуля — письмо «Сообщить о поступлении», аудит', async () => {
      const p = await product();
      const [m, l] = p.variants;
      expect([m.sku, l.sku, l.stock]).toEqual(['K-M', 'K-L', 0]);
      // Гость подписан на вариант без остатка
      const sub = await agent(app).post('/api/restock').set('Origin', ORIGIN).set('X-Forwarded-For', '10.77.0.1').send({ variantId: l.id, email: 'wait@example.ru', consent: true });
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      const { key } = await newKey();

      const res = await api().put('/api/partner/v1/stock').set(bearer(key)).send({ items: [{ sku: 'K-M', stock: 3 }, { sku: 'K-L', stock: 5 }, { sku: 'NOPE', stock: 1 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ received: 3, updated: 1, unchanged: 1, notFound: ['NOPE'] });
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: l.id } })).stock).toBe(5);
      expect(mails(app).some((x) => x.to === 'wait@example.ru' && x.subject.includes('снова в наличии'))).toBe(true);

      const pr = await api().put('/api/partner/v1/prices').set(bearer(key)).send({ items: [{ sku: 'K-M', price: 3990.5, oldPrice: 4590 }, { sku: 'K-L', price: 5000, oldPrice: 4000 }] });
      expect(pr.status, JSON.stringify(pr.body)).toBe(200);
      expect(pr.body).toMatchObject({ updated: 1, errors: [{ sku: 'K-L' }] });
      expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ price: 399050, oldPrice: 459000 });

      // Валидация пачки: повторы SKU, отрицательный остаток, больше 1000 позиций
      const dup = await api().put('/api/partner/v1/stock').set(bearer(key)).send({ items: [{ sku: 'K-M', stock: 1 }, { sku: 'K-M', stock: 2 }] });
      expect(dup.status).toBe(400);
      expect(JSON.stringify(dup.body.errors)).toMatch(/повторяется/);
      expect((await api().put('/api/partner/v1/stock').set(bearer(key)).send({ items: [{ sku: 'K-M', stock: -1 }] })).status).toBe(400);
      const big = Array.from({ length: 1001 }, (_, i) => ({ sku: `S${i}`, stock: 1 }));
      expect((await api().put('/api/partner/v1/stock').set(bearer(key)).send({ items: big })).status).toBe(400);
      const ok1000 = await api().put('/api/partner/v1/stock').set(bearer(key)).send({ items: big.slice(0, 1000) });
      expect(ok1000.body.notFound).toHaveLength(1000);

      const audit = await prisma.auditLog.findMany({ where: { action: { in: ['partner.stock', 'partner.prices'] } } });
      expect(audit.length).toBeGreaterThanOrEqual(3);
      expect(audit[0].actorId).toBeNull();
    });

    it('отправления: только свои; подтверждение; чужое — 404; чужой SKU не меняется', async () => {
      const { agent: other, supplierId: otherId } = await makeSupplier(app, admin, 'other@sup.ru', '7728168971');
      const otherProduct = await product(other, 'Чужой костюм', ['O-M', 'O-L']);
      const mine = await shipment(supplierId);
      const foreign = await shipment(otherId);
      const { key } = await newKey();

      const list = await api().get('/api/partner/v1/orders?status=new').set(bearer(key));
      expect(list.status).toBe(200);
      expect(list.body.items.map((s: { id: string }) => s.id)).toEqual([mine.id]);
      expect(list.body.items[0]).toMatchObject({ status: 'new', goodsTotal: 4590, items: [{ sku: 'K-M', qty: 1, price: 4590 }] });
      expect(list.body.items[0].confirmBefore).toBeTruthy();
      // Контактов покупателя в API нет — только имя для накладной
      expect(JSON.stringify(list.body)).not.toContain('buyer@example.ru');
      expect((await api().get('/api/partner/v1/orders?status=bogus').set(bearer(key))).status).toBe(400);

      expect((await api().post(`/api/partner/v1/orders/${foreign.id}/confirm`).set(bearer(key))).status).toBe(404);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe('new');
      const ok = await api().post(`/api/partner/v1/orders/${mine.id}/confirm`).set(bearer(key));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ id: mine.id, status: 'confirmed' });
      expect((await api().post(`/api/partner/v1/orders/${mine.id}/confirm`).set(bearer(key))).status).toBe(409);
      const ev = await prisma.auditLog.findFirstOrThrow({ where: { action: 'shipment.confirmed', entityId: mine.id } });
      expect(ev.data).toMatchObject({ via: 'partner_api' });

      // SKU другого поставщика не находится
      const st = await api().put('/api/partner/v1/stock').set(bearer(key)).send({ items: [{ sku: 'O-M', stock: 99 }] });
      expect(st.body.notFound).toEqual(['O-M']);
      expect((await prisma.productVariant.findFirstOrThrow({ where: { productId: otherProduct.id, sku: 'O-M' } })).stock).toBe(3);
    });

    it('лимит частоты — на ключ: 429 с Retry-After, у другого ключа свой счётчик; заблокированный поставщик — 403', async () => {
      const prev = config.partnerApi.rpm;
      config.partnerApi.rpm = 3;
      try {
        const a = await newKey('a');
        const b = await newKey('b');
        for (let i = 0; i < 3; i++) expect((await api().get('/api/partner/v1/orders').set(bearer(a.key))).status).toBe(200);
        const limited = await api().get('/api/partner/v1/orders').set(bearer(a.key));
        expect(limited.status).toBe(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect((await api().get('/api/partner/v1/orders').set(bearer(b.key))).status).toBe(200);
        await prisma.supplier.update({ where: { id: supplierId }, data: { status: 'blocked' } });
        expect((await api().get('/api/partner/v1/orders').set(bearer(b.key))).status).toBe(403);
      } finally {
        config.partnerApi.rpm = prev;
      }
    });
  });

  // ─── аналитика ───────────────────────────────────────────────────────

  describe('аналитика продаж', () => {
    it('выручка и штуки по дням, топ, доля возвратов, воронка корзина → заказ, капсулы и нулевые остатки', async () => {
      const a = await product(sup, 'Костюм А', ['A-M', 'A-L']);
      const b = await product(sup, 'Халат Б', ['B-M', 'B-L']);
      const [am] = a.variants;
      const [bm, bl] = b.variants;
      const day = 86_400_000;
      const now = Date.now();
      // Сегодня: 2 шт. А по 4590; 3 дня назад: 1 шт. Б по 6000 (1 вернули); отменённое и старше 90 дней — не считаются
      await shipment(supplierId, { status: 'delivered', paidAt: new Date(now), items: [{ variantId: am.id, title: 'Костюм А', sku: 'A-M', price: 459000, qty: 2 }] });
      await shipment(supplierId, { status: 'delivered', paidAt: new Date(now - 3 * day), items: [{ variantId: bm.id, title: 'Халат Б', sku: 'B-M', price: 600000, qty: 1, returnedQty: 1 }] });
      await shipment(supplierId, { status: 'cancelled', paidAt: new Date(now), items: [{ variantId: am.id, title: 'Костюм А', sku: 'A-M', price: 459000, qty: 5 }] });
      await shipment(supplierId, { status: 'delivered', paidAt: new Date(now - 100 * day), items: [{ variantId: am.id, title: 'Костюм А', sku: 'A-M', price: 459000, qty: 7 }] });
      // Чужие продажи не видны
      const { supplierId: otherId } = await makeSupplier(app, admin, 'other@sup.ru', '7728168971');
      await shipment(otherId, { paidAt: new Date(now), items: [{ title: 'Чужое', sku: 'X', price: 100000, qty: 9 }] });

      // Корзина вошедшего покупателя пишет «добавления в корзину»
      const buyer = await makeUser(app, 'cart@example.ru');
      expect((await buyer.put('/api/cart').set('Origin', ORIGIN).send({ lines: [{ variantId: am.id, qty: 1 }, { variantId: bm.id, qty: 1 }] })).status).toBe(200);
      await buyer.put('/api/cart').set('Origin', ORIGIN).send({ lines: [{ variantId: am.id, qty: 2 }, { variantId: bm.id, qty: 1 }] });

      // Капсулы: А — в двух, Б (вариант L без остатка) — в трёх
      const users = await Promise.all(['c1', 'c2', 'c3'].map((n) => prisma.user.create({ data: { email: `${n}@example.ru`, passwordHash: 'x' } })));
      for (const [i, u] of users.entries()) {
        const cap = await prisma.capsule.create({ data: { userId: u.id, variantNo: 1, total: 0 } });
        await prisma.capsuleItem.create({ data: { capsuleId: cap.id, slot: 'gown', productId: b.id, variantId: bl.id } });
        if (i < 2) await prisma.capsuleItem.create({ data: { capsuleId: cap.id, slot: 'suit', productId: a.id, variantId: am.id } });
      }

      let res = await sup.get('/api/supplier/analytics?days=30');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const r = res.body;
      expect(r.series).toHaveLength(30);
      expect(r.series.reduce((s: number, d: { units: number }) => s + d.units, 0)).toBe(3);
      expect(r.series.at(-1)).toMatchObject({ revenue: 918000, units: 2, orders: 1 });
      expect(r.totals).toMatchObject({ revenue: 1518000, units: 3, orders: 2, avgOrder: 759000, returnedUnits: 1, returnedSum: 600000 });
      expect(r.totals.returnRate).toBeCloseTo(1 / 3);
      expect(r.top.map((t: { title: string; units: number }) => [t.title, t.units])).toEqual([['Костюм А', 2], ['Халат Б', 1]]);
      // Просмотров нет — воронка с корзины: А добавили дважды (1 → 2), Б — один раз
      expect(r.funnel).toMatchObject({ viewsTracked: false, views: 0, cartAdds: 3, orderLines: 2, orders: 2 });
      expect(r.capsules.map((c: { title: string; hits: number }) => [c.title, c.hits])).toEqual([['Халат Б', 3], ['Костюм А', 2]]);
      expect(r.zeroInCapsules).toEqual([expect.objectContaining({ title: 'Халат Б', zeroHits: 3, hits: 3, stock: 3 })]);

      // Счётчик просмотров (подключается витриной) включает воронку с просмотров
      await app.get(ProductStatsService).view(a.id);
      await app.get(ProductStatsService).view(a.id);
      res = await sup.get('/api/supplier/analytics?days=90');
      expect(res.body.series).toHaveLength(90);
      expect(res.body.funnel).toMatchObject({ viewsTracked: true, views: 2 });
      expect(res.body.totals.units).toBe(3);

      // Только владелец
      const catalog = await member('catalog@sup.ru', 'catalog');
      expect((await catalog.get('/api/supplier/analytics')).status).toBe(403);
    });
  });

  describe('счётчик просмотров карточки', () => {
    const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const views = async (productId: string) => (await prisma.productDailyStat.findMany({ where: { productId } })).reduce((s, r) => s + r.views, 0);

    it('страница товара: просмотр считается раз в час на сессию, роботы не считаются', async () => {
      const p = await product();
      const get = (a: Agent, ua: string, viaNext = true) => a.get(`/api/catalog/products/${p.slug}`).set(viaNext ? { 'X-Client-UA': ua, 'User-Agent': 'node' } : { 'User-Agent': ua });
      const guest = agent(app);
      expect((await get(guest, CHROME)).status).toBe(200);
      await get(guest, CHROME); // повтор (generateMetadata + страница, обновление) — не считается
      await new Promise((r) => setTimeout(r, 50));
      expect(await views(p.id)).toBe(1);
      // Другая сессия (вошедший покупатель) — отдельный просмотр; браузер напрямую — тоже
      const buyer = await makeUser(app, 'viewer@example.ru');
      await get(buyer, CHROME);
      await get(buyer, CHROME, false);
      // Роботы и пустой User-Agent
      for (const ua of ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'curl/8.4.0', 'Mozilla/5.0 HeadlessChrome/130.0', '']) await get(agent(app), ua);
      await new Promise((r) => setTimeout(r, 50));
      expect(await views(p.id)).toBe(2);
      const r = await sup.get('/api/supplier/analytics');
      expect(r.body.funnel).toMatchObject({ viewsTracked: true, views: 2 });
    });
  });

  // ─── массовая печать ─────────────────────────────────────────────────

  describe('массовая печать', () => {
    const post = (a: Agent, path: string, body: unknown) => a.post(`/api/supplier/orders/print/${path}`).set('Origin', ORIGIN).send(body as object).buffer(true).parse(binary);

    it('накладные одним PDF и акт приёма-передачи; только свои отправления и с накладной', async () => {
      const s1 = await shipment(supplierId, { status: 'handed_over', cdek: true });
      const s2 = await shipment(supplierId, { status: 'handed_over', cdek: true, items: [{ title: 'Халат', sku: 'H-1', price: 600000, qty: 2 }] });
      const noWaybill = await shipment(supplierId, { status: 'packed' });
      const { supplierId: otherId } = await makeSupplier(app, admin, 'other@sup.ru', '7728168971');
      const foreign = await shipment(otherId, { status: 'handed_over', cdek: true });

      const w = await post(sup, 'waybills', { ids: [s1.id, s2.id] });
      expect(w.status).toBe(200);
      expect(w.headers['content-type']).toBe('application/pdf');
      expect(w.headers['content-disposition']).toMatch(/nakladnye-\d{8}-2\.pdf/);
      expect(w.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdfPageCount(w.body)).toBe(2);
      expect(pdfText(w.body)).toMatch(/Накладная СДЭК — тестовый режим/);
      const labels = await post(sup, 'waybills', { ids: [s1.id], kind: 'barcode' });
      expect(pdfPageCount(labels.body)).toBe(1);

      const act = await post(sup, 'act', { ids: [s1.id, s2.id] });
      expect(act.status).toBe(200);
      expect(act.headers['content-disposition']).toMatch(/akt-sdek-\d{8}-2\.pdf/);
      const text = pdfText(act.body);
      expect(text).toMatch(/Акт приёма-передачи отправлений/);
      const n1 = (await prisma.order.findUniqueOrThrow({ where: { id: s1.orderId } })).number;
      expect(text).toContain(`${n1}-1`);
      expect(text).toContain(s2.trackNo!);
      expect(text).toMatch(/Итого: отправлений 2, мест 2, вес 1,20 кг/);
      expect(text).toMatch(/Принял \(курьер СДЭК\)/);

      // Чужое отправление в пачке — 404, без накладной — 400 с номером
      expect((await post(sup, 'act', { ids: [s1.id, foreign.id] })).status).toBe(404);
      expect((await post(sup, 'waybills', { ids: [foreign.id] })).status).toBe(404);
      const bad = await sup.post('/api/supplier/orders/print/act').set('Origin', ORIGIN).send({ ids: [s1.id, noWaybill.id] });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/Нет накладной СДЭК/);
      expect((await sup.post('/api/supplier/orders/print/act').set('Origin', ORIGIN).send({ ids: [] })).status).toBe(400);

      // Склад печатает, каталог — нет
      const wh = await member('wh@sup.ru', 'warehouse');
      expect((await post(wh, 'act', { ids: [s1.id] })).status).toBe(200);
      const catalog = await member('catalog@sup.ru', 'catalog');
      expect((await catalog.post('/api/supplier/orders/print/act').set('Origin', ORIGIN).send({ ids: [s1.id] })).status).toBe(403);
    });
  });
});
