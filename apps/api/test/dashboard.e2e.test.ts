import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { agent, bootApp, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

const HOUR = 3600000;

describe('дашборд платформы: деньги, воронка, сроки модерации, очереди, кэш', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Agent;
  let supplierId: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    owner = await makeUser(app, 'owner@example.ru', 'admin');
    ({ supplierId } = await makeSupplier(app, owner, 'sup@example.ru', '7707083893'));
  });

  let n = 800000;
  /** Оплаченный заказ: отправления [товары, комиссия, статус, из капсулы] */
  async function paidOrder(email: string, paidAt: Date, shipments: [number, number, 'new' | 'cancelled' | 'delivered', boolean][], status: 'paid' | 'cancelled' = 'paid') {
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: 'x' } });
    const goods = shipments.reduce((s, x) => s + x[0], 0);
    return prisma.order.create({
      data: {
        number: String(++n), userId: user.id, status, paymentStatus: 'succeeded', goodsTotal: goods, deliveryTotal: 30000, total: goods + 30000, paidAt,
        recipientName: 'А', recipientPhone: '+79990000000', recipientEmail: email, expiresAt: paidAt,
        shipments: {
          create: shipments.map(([g, c, st, capsule], i) => ({
            no: i + 1, supplierId, status: st, deliveryType: 'pvz' as const, tariffCode: 136, cityCode: 44, address: 'Москва', deliveryPrice: 15000, periodMin: 1, periodMax: 2,
            goodsTotal: g, commissionBp: 1000, commission: c, paidAt,
            items: { create: { title: 'Костюм', brand: 'Б', sku: `S${n}-${i}`, size: 'M', color: 'Белый', price: g, qty: 1, fromCapsule: capsule } },
          })),
        },
      },
    });
  }

  it('доступ: владелец и поддержка — да, модератор и покупатель — нет; /admin ведёт владельца на дашборд (меню)', async () => {
    expect((await owner.get('/api/admin/dashboard')).status).toBe(200);
    const support = await makeUser(app, 'support@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'support@example.ru' }, data: { staffRole: 'support' } });
    expect((await support.get('/api/admin/dashboard')).status).toBe(200);
    const moderator = await makeUser(app, 'mod@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'mod@example.ru' }, data: { staffRole: 'moderator' } });
    expect((await moderator.get('/api/admin/dashboard')).status).toBe(403);
    expect((await (await makeUser(app, 'buyer@example.ru')).get('/api/admin/dashboard')).status).toBe(403);
    expect((await agent(app).get('/api/admin/dashboard')).status).toBe(401);
  });

  it('GMV и комиссия за сегодня / 7 / 30 дней, график по дням, средний чек, доля заказов с капсулой', async () => {
    const now = new Date();
    // Сегодня: два отправления, одно отменено — в GMV только живое; из капсулы
    await paidOrder('a@example.ru', new Date(now.getTime() - 60_000), [[400000, 40000, 'new', true], [100000, 10000, 'cancelled', false]]);
    // 3 дня назад — без капсулы
    await paidOrder('b@example.ru', new Date(now.getTime() - 3 * 24 * HOUR), [[200000, 30000, 'delivered', false]]);
    // 20 дней назад
    await paidOrder('c@example.ru', new Date(now.getTime() - 20 * 24 * HOUR), [[300000, 30000, 'delivered', true]]);
    // Не считаются: 40 дней назад и целиком отменённый
    await paidOrder('d@example.ru', new Date(now.getTime() - 40 * 24 * HOUR), [[900000, 90000, 'delivered', false]]);
    await paidOrder('e@example.ru', new Date(now.getTime() - HOUR), [[700000, 70000, 'cancelled', false]], 'cancelled');

    const d = (await owner.get('/api/admin/dashboard?refresh=1').expect(200)).body;
    expect(d.periods.today).toMatchObject({ gmv: 400000, commission: 40000, orders: 1 });
    expect(d.periods.week).toMatchObject({ gmv: 600000, commission: 70000, orders: 2 });
    expect(d.periods.month).toMatchObject({ gmv: 900000, commission: 100000, orders: 3 });
    // Средний чек — по сумме заказа (товары + доставка, включая отменённое отправление: так заплатил покупатель)
    expect(d.periods.month.avgCheck).toBe(Math.round((530000 + 230000 + 330000) / 3));
    expect(d.days).toHaveLength(30);
    expect(d.days.reduce((s: number, x: { gmv: number }) => s + x.gmv, 0)).toBe(900000);
    expect(d.days.at(-1).gmv).toBe(400000);
    expect(d.funnel).toMatchObject({ orders: 3, capsuleOrders: 2, capsuleShare: 66.7, capsuleToCart: null });
    expect(d.queues.unconfirmed).toBe(0);
  });

  it('воронка подбора: начата анкета (первый ответ, не открытие профиля) → пройдена → капсула', async () => {
    const b1 = await makeUser(app, 'q1@example.ru');
    const b2 = await makeUser(app, 'q2@example.ru');
    await b1.get('/api/me/profile').expect(200);
    await b2.get('/api/me/profile').expect(200);
    let d = (await owner.get('/api/admin/dashboard?refresh=1')).body;
    expect(d.funnel.quizStarted).toBe(0);
    await b1.put('/api/me/profile').set('Origin', 'http://localhost:4000').send({ gender: 'female' }).expect(200);
    await prisma.buyerProfile.update({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'q2@example.ru' } })).id }, data: { quizStartedAt: new Date(), quizCompletedAt: new Date() } });
    await prisma.capsule.create({ data: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'q2@example.ru' } })).id, variantNo: 1, total: 0 } });
    d = (await owner.get('/api/admin/dashboard?refresh=1')).body;
    expect(d.funnel).toMatchObject({ quizStarted: 2, quizCompleted: 1, capsulesBuilt: 1 });
  });

  it('сроки модерации: медиана и p90 от отправки до решения, превышение SLA 24 ч, зависшие в очереди', async () => {
    const brand = await prisma.brand.create({ data: { name: 'Б', slug: 'b' } });
    const cat = await prisma.category.findFirstOrThrow();
    const ago = (h: number) => new Date(Date.now() - h * HOUR);
    const mk = async (title: string, status: 'pending' | 'published', submittedAt: Date) =>
      prisma.product.create({ data: { supplierId, brandId: brand.id, categoryId: cat.id, title, slug: title, moderationStatus: status, submittedAt } });
    // Решено за 2 ч и за 30 ч (повторная отправка — считается от последней)
    const p1 = await mk('p1', 'published', ago(10));
    await prisma.auditLog.createMany({ data: [{ action: 'product.submit', entity: 'product', entityId: p1.id, at: ago(10) }, { action: 'moderation.product.approve', entity: 'product', entityId: p1.id, at: ago(8) }] });
    const p2 = await mk('p2', 'published', ago(40));
    await prisma.auditLog.createMany({
      data: [
        { action: 'product.submit', entity: 'product', entityId: p2.id, at: ago(100) },
        { action: 'product.submit', entity: 'product', entityId: p2.id, at: ago(40) },
        { action: 'moderation.product.approve', entity: 'product', entityId: p2.id, at: ago(10) },
      ],
    });
    // Висит в очереди 30 ч
    await mk('p3', 'pending', ago(30));
    // Отзыв: создан 5 ч назад, одобрен 1 ч назад
    const buyer = await prisma.user.create({ data: { email: 'r@example.ru', passwordHash: 'x' } });
    const r = await prisma.review.create({ data: { productId: p1.id, userId: buyer.id, authorName: 'Р', rating: 5, fit: 'true_to_size', text: 'Хороший товар', status: 'approved' } });
    await prisma.auditLog.createMany({ data: [{ action: 'review.create', entity: 'review', entityId: r.id, at: ago(5) }, { action: 'moderation.review.approve', entity: 'review', entityId: r.id, at: ago(1) }] });

    const d = (await owner.get('/api/admin/dashboard?refresh=1')).body;
    const row = (kind: string) => d.moderation.rows.find((x: { kind: string }) => x.kind === kind);
    expect(d.moderation.slaHours).toBe(24);
    expect(row('product')).toMatchObject({ decided: 2, medianHours: 16, overSla: 1, pendingOverSla: 1 });
    expect(row('product').p90Hours).toBeCloseTo(27.2, 1);
    expect(row('review')).toMatchObject({ decided: 1, medianHours: 4, overSla: 0 });
    expect(row('all')).toMatchObject({ decided: 3, overSla: 1, pendingOverSla: 1 });
    expect(d.queues.moderationProducts).toBe(1);
  });

  it('очереди «требуют внимания» и кэш на 5 минут (refresh=1 пересчитывает)', async () => {
    await paidOrder('late@example.ru', new Date(Date.now() - 30 * HOUR), [[100000, 10000, 'new', false]]);
    await prisma.premiumLead.create({ data: { name: 'Анна', phone: '+79990000000', contact: 'phone', capsule: {}, answers: {} } });
    let d = (await owner.get('/api/admin/dashboard').expect(200)).body;
    expect(d.queues).toMatchObject({ problemOrders: 1, unconfirmed: 1, premium: 1, returns: 0, applications: 0 });
    await prisma.premiumLead.create({ data: { name: 'Борис', phone: '+79990000001', contact: 'phone', capsule: {}, answers: {} } });
    d = (await owner.get('/api/admin/dashboard')).body;
    expect(d.queues.premium).toBe(1);
    expect(d.cacheSeconds).toBe(300);
    d = (await owner.get('/api/admin/dashboard?refresh=1')).body;
    expect(d.queues.premium).toBe(2);
  });
});
