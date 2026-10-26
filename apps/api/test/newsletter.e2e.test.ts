import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { PASSWORD, ORIGIN, agent, bootApp, mails, makeSupplier, makeUser, resetDb, tokenFrom, type Agent } from './helpers';

const DAY = 86400000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('рассылка покупателям по акции (ТЗ §7.7, §11)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let promotionId: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  /** Покупатель напрямую в БД: по умолчанию с подтверждённым email и согласием на рассылку */
  const buyer = async (email: string, o: { marketing?: boolean; revoked?: boolean; verified?: boolean; blocked?: boolean; deleted?: boolean; role?: 'buyer' | 'admin' } = {}) => {
    const u = await prisma.user.create({
      data: {
        email, role: o.role ?? 'buyer', passwordHash: await argon2.hash(PASSWORD),
        emailVerifiedAt: o.verified === false ? null : new Date(),
        blockedAt: o.blocked ? new Date() : null,
        deletedAt: o.deleted ? new Date() : null,
      },
    });
    await prisma.consent.create({ data: { userId: u.id, type: 'pdn', version: '1' } });
    if (o.marketing !== false) await prisma.consent.create({ data: { userId: u.id, type: 'marketing', version: '1', revokedAt: o.revoked ? new Date() : null } });
    return u;
  };
  const login = async (email: string) => {
    const a = agent(app);
    await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
    return a;
  };
  const letters = () => mails(app).filter((m) => m.subject.includes('Неделя хирурга: скидки'));
  const start = (a: Agent = admin) => a.post(`/api/admin/promotions/${promotionId}/newsletter`).set('Origin', ORIGIN);

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    const sup = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893');
    await prisma.supplier.update({ where: { id: sup.supplierId }, data: { payoutStatus: 'active', yookassaAccountId: 'acc' } });
    const brand = await prisma.brand.create({ data: { name: 'МедТекс', slug: 'medteks' } });
    const product = await prisma.product.create({
      data: {
        supplierId: sup.supplierId, brandId: brand.id, categoryId: (await prisma.category.findFirstOrThrow()).id, title: 'Костюм «Хирург»', slug: 'kostyum-hirurg',
        gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(),
        variants: { create: [{ sku: 'K-M', size: 'M', colorId: (await prisma.color.findFirstOrThrow()).id, price: 500000, stock: 5 }] },
      },
    });
    const res = await admin.post('/api/admin/promotions').set('Origin', ORIGIN).send({
      name: 'Неделя хирурга', description: 'Скидки на хирургические костюмы.', badge: 'Неделя хирурга', minDiscountPct: 15, commissionPct: 8,
      applyFrom: iso(-2 * DAY), applyTo: iso(DAY), startsAt: iso(-DAY), endsAt: iso(7 * DAY), newsletter: true,
    }).expect(201);
    promotionId = res.body.id;
    await prisma.promotionProduct.create({ data: { promotionId, productId: product.id, supplierId: sup.supplierId, discountPct: 20, status: 'approved' } });
    mails(app).length = 0;
  });

  it('получают только покупатели с действующим согласием, подтверждённым email, не заблокированные и не удалённые', async () => {
    await buyer('yes1@example.ru');
    await buyer('yes2@example.ru');
    await buyer('yes3@example.ru'); // три получателя при пачке 2 — проверяет переход между пачками
    await buyer('noconsent@example.ru', { marketing: false });
    await buyer('revoked@example.ru', { revoked: true });
    await buyer('unverified@example.ru', { verified: false });
    await buyer('blocked@example.ru', { blocked: true });
    await buyer('deleted@example.ru', { deleted: true });
    await buyer('staff@example.ru', { role: 'admin' });

    const preview = await admin.get(`/api/admin/promotions/${promotionId}/newsletter`).expect(200);
    expect(preview.body).toMatchObject({ recipients: 3, pending: 3, campaign: null });

    const res = await start().expect(200);
    // JOBS_INLINE: задача выполнена к ответу
    expect(res.body.campaign).toMatchObject({ status: 'done', total: 3, sent: 3, failed: 0 });
    expect(res.body.pending).toBe(0);
    expect(letters().map((m) => m.to).sort()).toEqual(['yes1@example.ru', 'yes2@example.ru', 'yes3@example.ru']);

    const m = letters()[0];
    expect(m.text).toContain('Неделя хирурга');
    expect(m.text).toContain('Скидки на хирургические костюмы.');
    expect(m.text).toContain('Костюм «Хирург»');
    expect(m.text).toMatch(/4\s000 ₽ вместо 5\s000 ₽/);
    expect(m.text).toContain('http://localhost:4000/catalog?sale=1');
    expect(m.text).toContain('http://localhost:4000/product/kostyum-hirurg');
    expect(m.text).toMatch(/Отписаться: http:\/\/localhost:4000\/unsubscribe\?token=/);
    expect(m.headers?.['List-Unsubscribe']).toMatch(/^<http:\/\/localhost:4000\/api\/newsletter\/unsubscribe\?token=[\w-]+>$/);
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'promotion.newsletter', entityId: promotionId } });
    expect(audit?.data).toMatchObject({ recipients: 3, pending: 3 });
  });

  it('повторный запуск не шлёт повторно уже получившим, но досылает новым подписчикам', async () => {
    await buyer('a@example.ru');
    await buyer('b@example.ru');
    await start().expect(200);
    expect(letters()).toHaveLength(2);

    const again = await start().expect(200);
    expect(again.body.campaign).toMatchObject({ status: 'done', total: 2, sent: 2 });
    expect(letters()).toHaveLength(2);

    await buyer('c@example.ru');
    expect((await admin.get(`/api/admin/promotions/${promotionId}/newsletter`)).body.pending).toBe(1);
    const third = await start().expect(200);
    expect(third.body.campaign).toMatchObject({ total: 3, sent: 3 });
    expect(letters().map((m) => m.to).sort()).toEqual(['a@example.ru', 'b@example.ru', 'c@example.ru']);
    expect(await prisma.newsletterDelivery.count({ where: { promotionId, status: 'sent' } })).toBe(3);

    // Пока рассылка идёт, второй запуск отклоняется
    await prisma.newsletterCampaign.update({ where: { promotionId }, data: { status: 'running' } });
    expect((await start()).status).toBe(409);
  });

  it('без отметки «рассылка» в акции и по завершённой акции не запускается', async () => {
    await buyer('a@example.ru');
    await prisma.promotion.update({ where: { id: promotionId }, data: { newsletter: false } });
    expect((await start()).status).toBe(400);
    await prisma.promotion.update({ where: { id: promotionId }, data: { newsletter: true, endsAt: new Date(Date.now() - 1000) } });
    expect((await start()).status).toBe(400);
    expect(letters()).toHaveLength(0);
  });

  it('отписка по токену отзывает согласие; подделанный токен не работает; профиль видит отзыв', async () => {
    const u = await buyer('a@example.ru');
    await buyer('b@example.ru');
    await start().expect(200);
    const token = tokenFrom(letters().find((m) => m.to === 'a@example.ru')!.text);
    expect(token).toMatch(/^[0-9a-f-]{36}-[0-9a-f]{32}$/);

    const anon = agent(app);
    const forged = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect((await anon.post('/api/newsletter/unsubscribe').set('Origin', ORIGIN).send({ token: forged })).status).toBe(400);
    // Подпись одного пользователя не подходит к id другого
    const other = (await prisma.user.findUniqueOrThrow({ where: { email: 'b@example.ru' } })).id;
    expect((await anon.post('/api/newsletter/unsubscribe').set('Origin', ORIGIN).send({ token: `${other}${token.slice(36)}` })).status).toBe(400);
    expect((await anon.post('/api/newsletter/unsubscribe').set('Origin', ORIGIN).send({ token: 'мусор' })).status).toBe(400);
    expect(await prisma.consent.count({ where: { userId: u.id, type: 'marketing', revokedAt: null } })).toBe(1);

    const ok = await anon.post('/api/newsletter/unsubscribe').set('Origin', ORIGIN).send({ token }).expect(200);
    expect(ok.body).toMatchObject({ ok: true, alreadyRevoked: false, email: 'a***@example.ru' });
    expect(await prisma.consent.count({ where: { userId: u.id, type: 'marketing', revokedAt: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'consent.revoke', entityId: u.id } })).toBe(1);
    // Повторный переход по ссылке — не ошибка
    expect((await anon.post('/api/newsletter/unsubscribe').set('Origin', ORIGIN).send({ token }).expect(200)).body.alreadyRevoked).toBe(true);

    // Профиль показывает снятое согласие; повторная подписка в профиле снова включает в рассылку
    const a = await login('a@example.ru');
    expect((await a.get('/api/me/consents')).body.marketing).toBe(false);
    expect((await admin.get(`/api/admin/promotions/${promotionId}/newsletter`)).body.recipients).toBe(1);
    await a.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'marketing', granted: true }).expect(200);
    expect((await admin.get(`/api/admin/promotions/${promotionId}/newsletter`)).body.recipients).toBe(2);
    // Снятие в профиле так же исключает из рассылки
    await a.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'marketing', granted: false }).expect(200);
    expect((await admin.get(`/api/admin/promotions/${promotionId}/newsletter`)).body.recipients).toBe(1);
  });

  it('one-click отписка почтового клиента: POST по ссылке из List-Unsubscribe без Origin', async () => {
    const u = await buyer('a@example.ru');
    await start().expect(200);
    const url = letters()[0].headers!['List-Unsubscribe'].slice(1, -1).replace('http://localhost:4000', '');
    await agent(app).post(url).type('form').send('List-Unsubscribe=One-Click').expect(200);
    expect(await prisma.consent.count({ where: { userId: u.id, type: 'marketing', revokedAt: null } })).toBe(0);
  });

  it('запустить и посмотреть рассылку может только сотрудник с доступом к акциям', async () => {
    await buyer('a@example.ru');
    const b = await login('a@example.ru');
    expect((await start(b)).status).toBe(403);
    expect((await b.get(`/api/admin/promotions/${promotionId}/newsletter`)).status).toBe(403);
    expect((await start(agent(app))).status).toBe(401);
    await buyer('stylist@example.ru', { role: 'admin', marketing: false });
    await prisma.user.update({ where: { email: 'stylist@example.ru' }, data: { staffRole: 'stylist' } });
    expect((await start(await login('stylist@example.ru'))).status).toBe(403);
    expect(letters()).toHaveLength(0);

    await buyer('editor@example.ru', { role: 'admin', marketing: false });
    await prisma.user.update({ where: { email: 'editor@example.ru' }, data: { staffRole: 'editor' } });
    expect((await start(await login('editor@example.ru'))).status).toBe(200);
    expect(letters()).toHaveLength(1);
  });
});
