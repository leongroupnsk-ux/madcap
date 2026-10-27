import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { OrdersService } from '../src/orders/orders.service';
import { FakePaymentsProvider } from '../src/payments/fake.provider';
import { SupplierOrdersService } from '../src/orders/supplier-orders.service';
import { ORIGIN, agent, bootApp, mails, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

const KAZAN = 424;

describe('заказ, оплата, доставка, возвраты и выплаты', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let buyer: Agent;
  let supA: { agent: Agent; supplierId: string };
  let supB: { agent: Agent; supplierId: string };
  let va: string;
  let vb: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function product(supplierId: string, title: string, price: number, stock: number) {
    const brand = await prisma.brand.upsert({ where: { name: 'МедТекс' }, update: {}, create: { name: 'МедТекс', slug: 'medteks' } });
    const cat = await prisma.category.findFirstOrThrow();
    const color = await prisma.color.findFirstOrThrow();
    const p = await prisma.product.create({
      data: {
        supplierId, brandId: brand.id, categoryId: cat.id, title, slug: `${title}-${Date.now()}-${Math.random()}`, gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(),
        variants: { create: [{ sku: `${title}-M`, size: 'M', colorId: color.id, price: price * 100, stock, weightG: 500 }] },
      },
      include: { variants: true },
    });
    return p.variants[0].id;
  }

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    supA = await makeSupplier(app, admin, 'a@sup.ru', '7707083893');
    supB = await makeSupplier(app, admin, 'b@sup.ru', '7736050003');
    await prisma.supplier.update({ where: { id: supA.supplierId }, data: { payoutStatus: 'active', yookassaAccountId: 'acc-a', commissionBp: 1000 } });
    await prisma.supplier.update({ where: { id: supB.supplierId }, data: { payoutStatus: 'active', yookassaAccountId: 'acc-b', commissionBp: 1500, cdekCityCode: 137, warehouseAddress: 'Санкт-Петербург' } });
    va = await product(supA.supplierId, 'Костюм', 4000, 3);
    vb = await product(supB.supplierId, 'Халат', 3000, 2);
    buyer = await makeUser(app, 'buyer@example.ru');
  });

  const lines = () => [{ variantId: va, qty: 2 }, { variantId: vb, qty: 1, fromCapsule: true }];
  const checkout = (extra: Record<string, unknown> = {}) => ({
    lines: lines(),
    recipient: { name: 'Елена Смирнова', phone: '+7 (999) 123-45-67', email: 'buyer@example.ru' },
    delivery: {
      [supA.supplierId]: { type: 'pvz', cityCode: KAZAN, city: 'Казань', pvzCode: '424-PVZ1', pvzAddress: 'ул. Ленина, 12' },
      [supB.supplierId]: { type: 'courier', cityCode: KAZAN, city: 'Казань', street: 'ул. Баумана, 5', flat: '12', comment: 'Домофон не работает' },
    },
    saveAddresses: true,
    ...extra,
  });
  const order = async () => {
    const res = await buyer.post('/api/orders').set('Origin', ORIGIN).send(checkout());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { number: string; confirmationUrl: string };
  };
  const payId = (url: string) => url.split('/pay/test/')[1];
  const pay = (url: string, result: 'card' | 'sbp' | 'fail' = 'card') => agent(app).post(`/api/payments/test/${payId(url)}`).set('Origin', ORIGIN).send({ result });
  const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
  const shipmentOf = (supplierId: string) => prisma.shipment.findFirstOrThrow({ where: { supplierId } });

  it('корзина: хранится у вошедшего, проверка показывает цену, остаток и недоступность', async () => {
    await buyer.put('/api/cart').set('Origin', ORIGIN).send({ lines: lines() }).expect(200);
    expect((await buyer.get('/api/cart')).body.lines).toHaveLength(2);
    await prisma.productVariant.update({ where: { id: vb }, data: { stock: 0 } });
    const res = await agent(app).post('/api/cart/check').set('Origin', ORIGIN).send({ lines: lines() }).expect(200);
    expect(res.body.items.find((i: any) => i.variantId === va)).toMatchObject({ available: true, price: 400000, stock: 3 });
    expect(res.body.items.find((i: any) => i.variantId === vb)).toMatchObject({ available: false, fromCapsule: true });
    expect((await agent(app).get('/api/cart')).status).toBe(401);
  });

  it('оформление: тарифы по отправлениям, резерв, сплит-оплата по вебхуку, письма', async () => {
    const quote = await agent(app).post('/api/checkout/quote').set('Origin', ORIGIN).send({ lines: lines(), cityCode: KAZAN }).expect(200);
    expect(quote.body).toHaveLength(2);
    expect(quote.body[0].options.map((o: any) => o.type)).toEqual(['pvz', 'courier']);

    expect((await agent(app).post('/api/orders').set('Origin', ORIGIN).send(checkout())).status).toBe(401);
    const missing = await buyer.post('/api/orders').set('Origin', ORIGIN).send(checkout({ delivery: {} }));
    expect(missing.status).toBe(400);

    const { number, confirmationUrl } = await order();
    expect(confirmationUrl).toContain('/pay/test/');
    expect(await stock(va)).toBe(1);
    expect(await stock(vb)).toBe(1);
    expect((await buyer.get('/api/cart')).body.lines).toEqual([]);
    expect(await prisma.address.count()).toBe(2);
    let view = (await buyer.get(`/api/orders/${number}`)).body;
    expect(view).toMatchObject({ status: 'pending_payment', goodsTotal: 1100000, recipient: { phone: '+79991234567' } });
    expect(view.shipments).toHaveLength(2);
    expect(view.total).toBe(view.goodsTotal + view.deliveryTotal);

    // Вебхук сам по себе ничего не меняет: статус перечитывается в платёжке
    const id = payId(confirmationUrl);
    await agent(app).post('/api/payments/webhook').send({ type: 'notification', event: 'payment.succeeded', object: { id } }).expect(200);
    expect((await buyer.get(`/api/orders/${number}`)).body.status).toBe('pending_payment');

    expect((await pay(confirmationUrl)).body).toMatchObject({ status: 'succeeded', orderNumber: number });
    await agent(app).post('/api/payments/webhook').send({ type: 'notification', event: 'payment.succeeded', object: { id } }).expect(200);
    view = (await buyer.get(`/api/orders/${number}`)).body;
    expect(view).toMatchObject({ status: 'paid', paymentMethod: 'Карта •••• 4242' });
    expect(view.shipments.map((s: any) => s.status)).toEqual(['new', 'new']);

    const payouts = await prisma.payout.findMany({ orderBy: { amountGoods: 'desc' } });
    expect(payouts.map((p) => [p.amountGoods, p.commission, p.transferred])).toEqual([
      [800000, 80000, 720000],
      [300000, 45000, 255000],
    ]);
    expect(mails(app).some((m) => m.to === 'buyer@example.ru' && m.subject.includes(`№ ${number} оплачен`))).toBe(true);
    expect(mails(app).some((m) => m.to === 'b@sup.ru' && m.subject.includes('Новый заказ'))).toBe(true);
    expect((await buyer.get('/api/orders')).body[0]).toMatchObject({ number, shipments: 2, status: 'paid' });
  });

  it('поставщик: видит только своё, подтверждение → упаковка → накладная → статусы СДЭК → доставлен; возврат', async () => {
    const { number, confirmationUrl } = await order();
    await pay(confirmationUrl);
    const sA = await shipmentOf(supA.supplierId);
    expect((await supB.agent.get(`/api/supplier/orders/${sA.id}`)).status).toBe(404);
    const list = (await supA.agent.get('/api/supplier/orders')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: `${number}-1`, status: 'new', customer: 'Елена Смирнова' });

    expect((await supA.agent.post(`/api/supplier/orders/${sA.id}/waybill`).set('Origin', ORIGIN)).status).toBe(400);
    await supA.agent.post(`/api/supplier/orders/${sA.id}/confirm`).set('Origin', ORIGIN).expect(200);
    expect((await supA.agent.post(`/api/supplier/orders/${sA.id}/confirm`).set('Origin', ORIGIN)).status).toBe(409);
    await supA.agent.post(`/api/supplier/orders/${sA.id}/pack`).set('Origin', ORIGIN).expect(200);
    const wb = await supA.agent.post(`/api/supplier/orders/${sA.id}/waybill`).set('Origin', ORIGIN).expect(200);
    expect(wb.body).toMatchObject({ status: 'handed_over', hasWaybill: true });
    expect(wb.body.trackNo).toMatch(/^\d{10}$/);
    const pdf = await supA.agent.get(`/api/supplier/orders/${sA.id}/documents/waybill`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    // Опрос СДЭК двигает статус только вперёд
    const sync = app.get(SupplierOrdersService);
    for (let i = 0; i < 4; i++) await sync.pollAll();
    let view = (await buyer.get(`/api/orders/${number}`)).body;
    const shipA = view.shipments.find((s: any) => s.no === 1);
    expect(shipA.status).toBe('delivered');
    expect(shipA.events.map((e: any) => e.status)).toEqual(expect.arrayContaining(['new', 'confirmed', 'packed', 'handed_over', 'in_transit', 'ready_for_pickup', 'delivered']));
    expect(shipA.canReturn).toBe(true);

    const itemId = shipA.items[0].id;
    expect((await buyer.post(`/api/orders/${number}/shipments/1/return`).set('Origin', ORIGIN).send({ items: [{ itemId, qty: 3 }], reason: 'Не подошёл размер' })).status).toBe(400);
    await buyer.post(`/api/orders/${number}/shipments/1/return`).set('Origin', ORIGIN).send({ items: [{ itemId, qty: 1 }], reason: 'Не подошёл размер' }).expect(200);
    const rr = await prisma.returnRequest.findFirstOrThrow();
    expect((await supB.agent.post(`/api/supplier/returns/${rr.id}/approve`).set('Origin', ORIGIN)).status).toBe(404);
    const approved = await supA.agent.post(`/api/supplier/returns/${rr.id}/approve`).set('Origin', ORIGIN).expect(200);
    expect(approved.body.returns[0].status).toBe('approved');
    const refund = await prisma.refund.findFirstOrThrow();
    expect(refund).toMatchObject({ amount: 400000, goodsAmount: 400000, commission: 40000, status: 'succeeded' });
    view = (await buyer.get(`/api/orders/${number}`)).body;
    expect(view.refunded).toBe(400000);

    const pay2 = (await supA.agent.get('/api/supplier/payouts')).body;
    expect(pay2.items.map((p: any) => p.transferred).sort()).toEqual([-360000, 720000].sort());
    const month = new Date().toISOString().slice(0, 7);
    const csv = await supA.agent.get(`/api/supplier/payouts/report?month=${month}`).expect(200);
    expect(csv.text).toContain('Возврат');
    expect(csv.text).toContain('7200,00');
  });

  it('отмена покупателем: неотгруженные отправления отменяются с возвратом сплит-платежа и снятием резерва', async () => {
    const { number, confirmationUrl } = await order();
    await pay(confirmationUrl);
    const sA = await shipmentOf(supA.supplierId);
    await supA.agent.post(`/api/supplier/orders/${sA.id}/confirm`).set('Origin', ORIGIN).expect(200);
    await supA.agent.post(`/api/supplier/orders/${sA.id}/pack`).set('Origin', ORIGIN).expect(200);
    await supA.agent.post(`/api/supplier/orders/${sA.id}/waybill`).set('Origin', ORIGIN).expect(200);

    const res = await buyer.post(`/api/orders/${number}/cancel`).set('Origin', ORIGIN).expect(200);
    expect(res.body.shipments.map((s: any) => s.status)).toEqual(['handed_over', 'cancelled']);
    expect(res.body.status).toBe('paid');
    expect(await stock(vb)).toBe(2);
    expect(await stock(va)).toBe(1);
    const refund = await prisma.refund.findFirstOrThrow();
    const sB = await shipmentOf(supB.supplierId);
    expect(refund.amount).toBe(300000 + sB.deliveryPrice);
    expect(refund.commission).toBe(45000);
    expect(await prisma.payout.count({ where: { kind: 'refund' } })).toBe(1);
    expect((await buyer.post(`/api/orders/${number}/cancel`).set('Origin', ORIGIN)).status).toBe(400);
  });

  it('неоплаченный заказ отменяется по таймеру; поздняя оплата возвращается автоматически', async () => {
    const { number, confirmationUrl } = await order();
    const o = await prisma.order.findUniqueOrThrow({ where: { number } });
    await prisma.order.update({ where: { id: o.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await app.get(OrdersService).sweep()).toMatchObject({ expired: 1 });
    expect((await buyer.get(`/api/orders/${number}`)).body.status).toBe('cancelled');
    expect(await stock(va)).toBe(3);
    expect(await stock(vb)).toBe(2);
    expect((await buyer.post(`/api/orders/${number}/pay`).set('Origin', ORIGIN)).status).toBe(400);

    await pay(confirmationUrl);
    expect((await buyer.get(`/api/orders/${number}`)).body.status).toBe('cancelled');
    expect(await prisma.refund.findFirstOrThrow()).toMatchObject({ amount: o.total, reason: 'Повторный или поздний платёж' });
  });

  it('неуспешная оплата → повторная попытка новым платежом', async () => {
    const { number, confirmationUrl } = await order();
    await pay(confirmationUrl, 'fail');
    expect((await buyer.get(`/api/orders/${number}`)).body).toMatchObject({ status: 'pending_payment', paymentStatus: 'canceled' });
    const retry = await buyer.post(`/api/orders/${number}/pay`).set('Origin', ORIGIN).expect(200);
    expect(retry.body.confirmationUrl).not.toBe(confirmationUrl);
    await pay(retry.body.confirmationUrl, 'sbp');
    expect((await buyer.get(`/api/orders/${number}`)).body).toMatchObject({ status: 'paid', paymentMethod: 'СБП' });
  });

  it('отклонение поставщиком и автоотмена через 48 ч возвращают деньги', async () => {
    const { number, confirmationUrl } = await order();
    await pay(confirmationUrl);
    const sA = await shipmentOf(supA.supplierId);
    const sB = await shipmentOf(supB.supplierId);
    expect((await supA.agent.post(`/api/supplier/orders/${sA.id}/reject`).set('Origin', ORIGIN).send({ reason: '' })).status).toBe(400);
    await supA.agent.post(`/api/supplier/orders/${sA.id}/reject`).set('Origin', ORIGIN).send({ reason: 'Нет в наличии' }).expect(200);
    await prisma.shipment.update({ where: { id: sB.id }, data: { paidAt: new Date(Date.now() - 49 * 3600000) } });
    expect(await app.get(OrdersService).sweep()).toMatchObject({ autoCancelled: 1 });
    const view = (await buyer.get(`/api/orders/${number}`)).body;
    expect(view.shipments.map((s: any) => s.status)).toEqual(['rejected', 'cancelled']);
    expect(view.status).toBe('cancelled');
    expect(view.refunded).toBe(view.total);
    expect(await prisma.payout.aggregate({ _sum: { transferred: true } })).toMatchObject({ _sum: { transferred: 0 } });
  });

  it('аудит безопасности: дубли в заявке на возврат, ПВЗ не из того города, чужой вебхук СДЭК', async () => {
    // ПВЗ из другого города, чем тот, по которому считается тариф
    const bad = await buyer.post('/api/orders').set('Origin', ORIGIN).send(checkout({ delivery: { ...checkout().delivery, [supA.supplierId]: { type: 'pvz', cityCode: KAZAN, city: 'Казань', pvzCode: '270-PVZ1', pvzAddress: 'дёшево' } } }));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/Пункт выдачи не найден/);

    const { number, confirmationUrl } = await order();
    await pay(confirmationUrl);
    const sA = await shipmentOf(supA.supplierId);
    // Адрес ПВЗ взят из СДЭК, а не из запроса
    expect(sA.address).toContain('ул. Ленина, 12');
    for (const step of ['confirm', 'pack', 'waybill']) await supA.agent.post(`/api/supplier/orders/${sA.id}/${step}`).set('Origin', ORIGIN).expect(200);
    for (let i = 0; i < 4; i++) await app.get(SupplierOrdersService).pollAll();
    const itemId = (await prisma.shipmentItem.findFirstOrThrow({ where: { shipmentId: sA.id } })).id;
    const dup = await buyer.post(`/api/orders/${number}/shipments/1/return`).set('Origin', ORIGIN).send({ items: [{ itemId, qty: 1 }, { itemId, qty: 1 }, { itemId, qty: 1 }], reason: 'Дубли' });
    expect(dup.status).toBe(400);
    expect(await prisma.returnRequest.count()).toBe(0);

    await agent(app).post('/api/delivery/cdek-webhook').send({ type: 'ORDER_STATUS', uuid: '00000000-0000-0000-0000-000000000000', attributes: { code: 'DELIVERED' } }).expect(200);
    expect(await prisma.webhookEvent.count({ where: { source: 'cdek' } })).toBe(0);
  });

  it('админка заказов: поиск, сверка находит потерянный вебхук, ручная отмена и частичный возврат', async () => {
    const { number, confirmationUrl } = await order();
    // Платёж прошёл, но вебхук «потерялся»: меняем статус только в платёжке
    await (app.get(OrdersService).payments as FakePaymentsProvider).settle(payId(confirmationUrl), 'card');
    expect((await buyer.get(`/api/orders/${number}`)).body.status).toBe('pending_payment');

    expect((await buyer.get('/api/admin/orders')).status).toBe(403);
    const found = (await admin.get('/api/admin/orders?q=999 123-45-67')).body;
    expect(found.map((o: any) => o.number)).toContain(number);
    const rec = (await admin.get('/api/admin/orders/reconcile')).body;
    expect(rec.mismatches).toEqual([{ number, problem: expect.stringMatching(/потерян вебхук/) }]);
    await admin.post(`/api/admin/orders/${number}/sync-payment`).set('Origin', ORIGIN).expect(200);
    expect((await admin.get('/api/admin/orders/reconcile')).body.mismatches).toEqual([]);

    // Отправление 1 уже у СДЭК — поставщик не отменит, поддержка может
    const sA = await shipmentOf(supA.supplierId);
    for (const step of ['confirm', 'pack', 'waybill']) await supA.agent.post(`/api/supplier/orders/${sA.id}/${step}`).set('Origin', ORIGIN).expect(200);
    const cancelled = await admin.post(`/api/admin/orders/${number}/shipments/1/cancel`).set('Origin', ORIGIN).send({ reason: 'Покупатель отказался, СДЭК вернёт посылку' }).expect(200);
    expect(cancelled.body.shipments[0].status).toBe('cancelled');

    // Отправление 2: частичный возврат за брак и доставка — только один раз
    const view = (await admin.get(`/api/admin/orders/${number}`)).body;
    const itemB = view.shipments[1].items[0];
    const refunded = await admin.post(`/api/admin/orders/${number}/shipments/2/refund`).set('Origin', ORIGIN).send({ items: [{ itemId: itemB.id, qty: 1 }], withDelivery: true, reason: 'Брак шва' }).expect(200);
    expect(refunded.body.shipments[1].items[0].returnedQty).toBe(1);
    expect((await admin.post(`/api/admin/orders/${number}/shipments/2/refund`).set('Origin', ORIGIN).send({ items: [], withDelivery: true, reason: 'Ещё раз' })).status).toBe(400);
    expect((await admin.post(`/api/admin/orders/${number}/shipments/2/refund`).set('Origin', ORIGIN).send({ items: [{ itemId: itemB.id, qty: 1 }], reason: 'Сверх' })).status).toBe(400);
    const sB = await shipmentOf(supB.supplierId);
    expect(refunded.body.refunds.at(-1).amount).toBe(300000 + sB.deliveryPrice);
    expect(await prisma.auditLog.count({ where: { action: { in: ['order.cancel.admin', 'order.refund.admin', 'order.payment.sync'] } } })).toBe(3);
  });

  it('гонка за остатком: заказ сверх наличия отклоняется, резерв не создаётся', async () => {
    const res = await buyer.post('/api/orders').set('Origin', ORIGIN).send(checkout({ lines: [{ variantId: va, qty: 4 }] }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('cart_changed');
    expect(await stock(va)).toBe(3);
    expect(await prisma.order.count()).toBe(0);
  });

  it('выплаты: реквизиты отправляют на повторную проверку, админ подключает ID получателя', async () => {
    const bad = await supA.agent.put('/api/supplier/payouts/details').set('Origin', ORIGIN).send({ legalName: 'ООО Тест', inn: '7707083893', account: '123', bik: '044525225' });
    expect(bad.status).toBe(400);
    const ok = await supA.agent
      .put('/api/supplier/payouts/details')
      .set('Origin', ORIGIN)
      .send({ legalName: 'ООО Тест', inn: '7707083893', account: '40702810900000012345', bik: '044525225' })
      .expect(200);
    expect(ok.body).toMatchObject({ payoutStatus: 'in_review', details: { account: '•••• 2345' } });
    // Товар поставщика с выплатами на проверке пропадает с витрины (поиск ищет и по категории — проверяем по названию)
    expect((await agent(app).get('/api/catalog/products?q=Костюм')).body.items.map((i: { title: string }) => i.title)).not.toContain('Костюм');
    expect((await supA.agent.get('/api/admin/payouts')).status).toBe(403);
    await admin.post(`/api/admin/payouts/${supA.supplierId}/activate`).set('Origin', ORIGIN).send({ accountId: 'acc-new' }).expect(200);
    expect((await supA.agent.get('/api/supplier/payouts')).body).toMatchObject({ payoutStatus: 'active', accountId: 'acc-new' });
  });

  it('аварийный режим: оплата без сплита, выплаты поставщикам реестром', async () => {
    const fake = app.get(OrdersService).payments as FakePaymentsProvider;
    expect((await supA.agent.put('/api/admin/payouts/registry/mode').set('Origin', ORIGIN).send({ mode: 'registry', reason: 'Сплит недоступен' })).status).toBe(403);
    expect((await admin.put('/api/admin/payouts/registry/mode').set('Origin', ORIGIN).send({ mode: 'registry', reason: '' })).status).toBe(400);
    await admin.put('/api/admin/payouts/registry/mode').set('Origin', ORIGIN).send({ mode: 'registry', reason: 'ЮKassa: сбой сплитования' }).expect(200);

    const { number, confirmationUrl } = await order();
    expect((await fake.load(payId(confirmationUrl))).request.transfers).toEqual([]);
    await pay(confirmationUrl);
    expect(await prisma.payout.count({ where: { manual: true } })).toBe(2);
    let ov = (await admin.get('/api/admin/payouts/registry')).body;
    expect(ov.mode.mode).toBe('registry');
    expect(ov.pending.suppliers).toEqual([]);
    expect(ov.pending.waiting.rows).toBe(2);

    // A доставлен; B отменён покупателем — возврат без sources, итог B = 0
    const sA = await shipmentOf(supA.supplierId);
    await prisma.shipment.update({ where: { id: sA.id }, data: { status: 'delivered' } });
    await buyer.post(`/api/orders/${number}/cancel`).set('Origin', ORIGIN).expect(200);
    expect((await fake.load(payId(confirmationUrl))).refunds[0].sources).toEqual([]);
    ov = (await admin.get('/api/admin/payouts/registry')).body;
    const byId = (id: string) => ov.pending.suppliers.find((x: any) => x.supplierId === id);
    expect(byId(supA.supplierId)).toMatchObject({ amount: 720000, problem: 'Нет банковских реквизитов' });
    expect(byId(supB.supplierId)).toMatchObject({ amount: 0, problem: expect.stringMatching(/не положительный/) });
    expect((await admin.post('/api/admin/payouts/registry').set('Origin', ORIGIN)).status).toBe(400);

    await prisma.supplier.update({ where: { id: supA.supplierId }, data: { payoutLegalName: 'ООО "Тест; А"', payoutInn: '7707083893', payoutBik: '044525225', payoutAccount: '40702810900000012345' } });
    ov = (await admin.post('/api/admin/payouts/registry').set('Origin', ORIGIN).expect(201)).body;
    const reg = ov.registries[0];
    expect(reg).toMatchObject({ total: 720000, rows: 1, paidAt: null });
    expect(ov.pending.suppliers.map((x: any) => x.supplierId)).toEqual([supB.supplierId]);
    const csv = await admin.get(`/api/admin/payouts/registry/${reg.id}/csv`).expect(200);
    expect(csv.text).toContain('"ООО ""Тест; А""";7707083893;044525225;40702810900000012345;7200,00;');
    expect(csv.text).toContain(`${number}-1`);

    await admin.post(`/api/admin/payouts/registry/${reg.id}/paid`).set('Origin', ORIGIN).expect(200);
    expect((await admin.post(`/api/admin/payouts/registry/${reg.id}/paid`).set('Origin', ORIGIN)).status).toBe(400);
    expect((await admin.post(`/api/admin/payouts/registry/${reg.id}/cancel`).set('Origin', ORIGIN)).status).toBe(400);
    const report = await supA.agent.get(`/api/supplier/payouts/report?month=${new Date().toISOString().slice(0, 7)}`).expect(200);
    expect(report.text).toContain(`Реестр ${reg.number}, оплачен`);

    // Обратно на сплит: новые заказы снова с transfers
    await admin.put('/api/admin/payouts/registry/mode').set('Origin', ORIGIN).send({ mode: 'split', reason: 'ЮKassa восстановила сплит' }).expect(200);
    await prisma.productVariant.update({ where: { id: va }, data: { stock: 5 } });
    const next = await order();
    expect((await fake.load(payId(next.confirmationUrl))).request.transfers).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'payouts.' } } })).toBe(5);
  });
});
