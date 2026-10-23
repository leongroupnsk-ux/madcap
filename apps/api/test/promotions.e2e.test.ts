import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { TelegramService } from '../src/notifications/telegram.service';
import { OrdersService } from '../src/orders/orders.service';
import { PromotionsService } from '../src/promotions/promotions.service';
import { repriceSales } from '../src/promotions/price';
import { ORIGIN, agent, bootApp, mails, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

const DAY = 86400000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('акции, уведомления, дашборд', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let buyer: Agent;
  let sup: { agent: Agent; supplierId: string };
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    app.get(TelegramService).sent.length = 0;
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    sup = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    await prisma.supplier.update({ where: { id: sup.supplierId }, data: { payoutStatus: 'active', yookassaAccountId: 'acc', commissionBp: 1000 } });
    const brand = await prisma.brand.create({ data: { name: 'МедТекс', slug: 'medteks' } });
    const p = await prisma.product.create({
      data: {
        supplierId: sup.supplierId, brandId: brand.id, categoryId: (await prisma.category.findFirstOrThrow()).id, title: 'Костюм «Хирург»', slug: `k-${Date.now()}`,
        gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(),
        variants: { create: [{ sku: 'K-M', size: 'M', colorId: (await prisma.color.findFirstOrThrow()).id, price: 500000, stock: 5 }] },
      },
      include: { variants: true },
    });
    productId = p.id;
    variantId = p.variants[0].id;
    buyer = await makeUser(app, 'buyer@example.ru');
  });

  const promo = (extra: Record<string, unknown> = {}) => ({
    name: 'Неделя хирурга', badge: 'Неделя хирурга', minDiscountPct: 15, commissionPct: 8,
    applyFrom: iso(-DAY), applyTo: iso(2 * DAY), startsAt: iso(3 * DAY), endsAt: iso(10 * DAY), onHomepage: true, ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) => (await admin.post('/api/admin/promotions').set('Origin', ORIGIN).send(promo(extra)).expect(201)).body as { id: string };
  const start = (id: string) => prisma.promotion.update({ where: { id }, data: { startsAt: new Date(Date.now() - 1000) } }).then(() => app.get(PromotionsService).reprice());
  const card = async () => (await agent(app).get('/api/catalog/products?q=Хирург')).body.items[0];
  const order = async () => {
    const res = await buyer.post('/api/orders').set('Origin', ORIGIN).send({
      lines: [{ variantId, qty: 2 }],
      recipient: { name: 'Елена', phone: '+79991234567', email: 'buyer@example.ru' },
      delivery: { [sup.supplierId]: { type: 'pvz', cityCode: 424, city: 'Казань', pvzCode: '424-PVZ1', pvzAddress: 'ул. Ленина, 12' } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await agent(app).post(`/api/payments/test/${res.body.confirmationUrl.split('/pay/test/')[1]}`).set('Origin', ORIGIN).send({ result: 'card' }).expect(200);
    return res.body.number as string;
  };

  it('акция: проверки дат, заявка с минимумом скидки, модерация, акционная цена на витрине и окончание', async () => {
    const bad = await admin.post('/api/admin/promotions').set('Origin', ORIGIN).send(promo({ endsAt: iso(DAY) }));
    expect(bad.status).toBe(400);
    expect((await sup.agent.post('/api/admin/promotions').set('Origin', ORIGIN).send(promo())).status).toBe(403);
    const { id } = await create();
    // Поставщиков оповестили о новой акции
    expect(mails(app).some((m) => m.to === 'owner@sup.ru' && m.subject.includes('Новая акция'))).toBe(true);

    const low = await sup.agent.post(`/api/supplier/promotions/${id}/products`).set('Origin', ORIGIN).send({ items: [{ productId, discountPct: 10 }] });
    expect(low.status).toBe(400);
    expect(low.body.errors[productId]).toMatch(/меньше минимальной/);
    const applied = await sup.agent.post(`/api/supplier/promotions/${id}/products`).set('Origin', ORIGIN).send({ items: [{ productId, discountPct: 20 }] }).expect(200);
    expect(applied.body.items[0]).toMatchObject({ status: 'pending', price: 500000, salePrice: 400000 });
    // Блок «Акции» в форме товара
    const block = (await sup.agent.get(`/api/supplier/promotions/product/${productId}`)).body;
    expect(block[0]).toMatchObject({ name: 'Неделя хирурга', status: 'pending', discountPct: 20, salePrice: 400000, acceptsApplications: true });
    const stranger = await makeSupplier(app, admin, 'other@sup.ru', '7736050003');
    expect((await stranger.agent.get(`/api/supplier/promotions/product/${productId}`)).status).toBe(404);

    const apps = (await admin.get('/api/admin/promotions/applications')).body;
    expect(apps).toHaveLength(1);
    await admin.post(`/api/admin/promotions/applications/${apps[0].id}/approve`).set('Origin', ORIGIN).expect(200);
    // До старта акции цена прежняя
    expect(await card()).toMatchObject({ price: 500000, promo: null });

    await start(id);
    expect(await card()).toMatchObject({ price: 400000, oldPrice: 500000, promo: 'Неделя хирурга', sale: true });
    const product = (await agent(app).get(`/api/catalog/products/${(await card()).slug}`)).body;
    expect(product.promo).toMatchObject({ badge: 'Неделя хирурга' });
    expect(product.variants[0]).toMatchObject({ price: 400000, oldPrice: 500000 });
    // Фильтр цены — по акционной цене
    expect((await agent(app).get('/api/catalog/products?priceTo=4500')).body.total).toBe(1);
    expect((await agent(app).get('/api/promotions/active')).body[0]).toMatchObject({ name: 'Неделя хирурга' });

    // Поставщик меняет цену (или приходит синк YML) — базовая цена его, акционная пересчитывается
    await prisma.productVariant.update({ where: { id: variantId }, data: { price: 600000 } });
    await repriceSales(prisma);
    expect(await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).toMatchObject({ price: 600000, salePrice: 480000 });

    await prisma.promotion.update({ where: { id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await app.get(PromotionsService).reprice();
    expect(await card()).toMatchObject({ price: 600000, oldPrice: null, promo: null });
  });

  it('сплит по акционной цене и льготной комиссии; возврат списывает ту же комиссию', async () => {
    const { id } = await create();
    await sup.agent.post(`/api/supplier/promotions/${id}/products`).set('Origin', ORIGIN).send({ items: [{ productId, discountPct: 20 }] }).expect(200);
    const appId = (await prisma.promotionProduct.findFirstOrThrow()).id;
    await admin.post(`/api/admin/promotions/applications/${appId}/approve`).set('Origin', ORIGIN).expect(200);
    await start(id);

    const number = await order();
    const s = await prisma.shipment.findFirstOrThrow({ include: { items: true } });
    expect(s.items[0]).toMatchObject({ price: 400000, commissionBp: 800, promotionId: id });
    expect(s).toMatchObject({ goodsTotal: 800000, commission: 64000 });
    expect(await prisma.payout.findFirstOrThrow()).toMatchObject({ amountGoods: 800000, commission: 64000, transferred: 736000 });
    const stats = (await sup.agent.get('/api/supplier/promotions')).body[0].stats;
    expect(stats).toMatchObject({ products: 1, soldWeek: 2 });

    await buyer.post(`/api/orders/${number}/cancel`).set('Origin', ORIGIN).expect(200);
    expect(await prisma.refund.findFirstOrThrow()).toMatchObject({ goodsAmount: 800000, commission: 64000 });
    expect((await prisma.payout.aggregate({ _sum: { transferred: true } }))._sum.transferred).toBe(0);
  });

  it('уведомления: центр, настройки событий, Telegram по коду, напоминание через сутки, нулевой остаток в капсулах', async () => {
    // Telegram: /start → код, ввод кода в кабинете
    const tg = app.get(TelegramService);
    await tg.handleUpdate({ update_id: 1, message: { chat: { id: 4242 }, text: '/start' } });
    const code = /(\d{6})/.exec(tg.sent.at(-1)!.text)![1];
    expect((await sup.agent.post('/api/supplier/notifications/telegram').set('Origin', ORIGIN).send({ code: '000000' })).status).toBe(400);
    const linked = await sup.agent.post('/api/supplier/notifications/telegram').set('Origin', ORIGIN).send({ code }).expect(200);
    expect(linked.body.telegramLinked).toBe(true);
    expect((await sup.agent.post('/api/supplier/notifications/telegram').set('Origin', ORIGIN).send({ code })).status).toBe(400);

    // Выключаем email для заказов: в центре и в Telegram уведомление есть, письма нет
    await sup.agent.put('/api/supplier/notifications/settings').set('Origin', ORIGIN).send({ email: true, mutedEvents: ['import_report'] }).expect(200);
    await sup.agent.put('/api/supplier/notifications/settings').set('Origin', ORIGIN).send({ email: false, mutedEvents: [] }).expect(200);

    // Капсула покупателя с этим вариантом; остаток станет 0 после заказа
    await prisma.productVariant.update({ where: { id: variantId }, data: { stock: 2 } });
    const buyerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'buyer@example.ru' } });
    await prisma.capsule.create({ data: { userId: buyerUser.id, variantNo: 1, total: 500000, items: { create: { slot: 'top', productId, variantId } } } });
    mails(app).length = 0;
    await order();

    const list = (await sup.agent.get('/api/supplier/notifications')).body;
    expect(list.items.map((n: any) => n.event)).toEqual(expect.arrayContaining(['order_paid', 'capsule_zero_stock']));
    expect(list.unread).toBeGreaterThanOrEqual(2);
    expect(mails(app).some((m) => m.to === 'owner@sup.ru')).toBe(false);
    expect(tg.sent.some((m) => m.chatId === '4242' && m.text.includes('Новый заказ'))).toBe(true);

    const read = await sup.agent.post('/api/supplier/notifications/read').set('Origin', ORIGIN).send({}).expect(200);
    expect(read.body.unread).toBe(0);

    // Напоминание «не подтверждён 24 ч» — один раз
    await prisma.shipment.updateMany({ data: { paidAt: new Date(Date.now() - 25 * 3600000) } });
    expect(await app.get(OrdersService).sweep()).toMatchObject({ overdue: 1, autoCancelled: 0 });
    expect(await app.get(OrdersService).sweep()).toMatchObject({ overdue: 0 });
    expect((await sup.agent.get('/api/supplier/notifications')).body.items[0].event).toBe('order_overdue');

    // Счётчики дашборда
    const counters = (await sup.agent.get('/api/supplier/orders/counters')).body;
    expect(counters).toMatchObject({ fresh: 1, overdue: 1, salesMonth: 1000000, zeroInCapsules: 1 });

    await sup.agent.delete('/api/supplier/notifications/telegram').set('Origin', ORIGIN).expect(200);
    expect((await sup.agent.get('/api/supplier/notifications/settings')).body).toMatchObject({ telegramLinked: false, email: false });
  });
});
