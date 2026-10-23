import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { StorageService } from '../src/common/storage.service';
import { PrivacyService } from '../src/me/privacy.service';
import { ORIGIN, PASSWORD, agent, bootApp, jpeg, makeUser, resetDb, type Agent } from './helpers';

describe('152-ФЗ: выгрузка, удаление, блокировка, срок хранения фото', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let buyer: Agent;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    buyer = await makeUser(app, 'buyer@example.ru');
    await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ gender: 'female', name: 'Елена', age: 31, heightCm: 170 }).expect(200);
    await buyer.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'photos', granted: true }).expect(200);
    await buyer.post('/api/me/photos').set('Origin', ORIGIN).attach('file', await jpeg(1), { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(201);
  });

  const photoPath = async () => app.get(StorageService).localPath((await prisma.profilePhoto.findFirstOrThrow()).storageKey);

  it('выгрузка своих данных: профиль, согласия, фото без файлов; только своё', async () => {
    const res = await buyer.get('/api/me/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.account.email).toBe('buyer@example.ru');
    expect(res.body.profile).toMatchObject({ name: 'Елена', age: 31 });
    expect(res.body.profile.photos).toHaveLength(1);
    expect(res.body.consents.map((c: any) => c.type)).toContain('photos');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totpSecret|storageKey/);
    expect((await agent(app).get('/api/me/export')).status).toBe(401);
  });

  it('удаление аккаунта: пароль, обезличивание, файлы фото удалены, email свободен', async () => {
    const file = await photoPath();
    expect(existsSync(file)).toBe(true);
    expect((await buyer.post('/api/me/delete').set('Origin', ORIGIN).send({ password: 'wrong-password' })).status).toBe(401);
    await buyer.post('/api/me/delete').set('Origin', ORIGIN).send({ password: PASSWORD }).expect(200);

    const u = await prisma.user.findFirstOrThrow({ where: { deletedAt: { not: null } } });
    expect(u.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(u.phone).toBeNull();
    expect(await prisma.buyerProfile.count()).toBe(0);
    expect(await prisma.profilePhoto.count()).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(await prisma.consent.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    expect((await buyer.get('/api/me/profile')).status).toBe(401);
    expect((await agent(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'buyer@example.ru', password: PASSWORD })).status).toBe(401);
    // Тот же email можно зарегистрировать заново
    await makeUser(app, 'buyer@example.ru');
  });

  it('удаление невозможно, пока заказ в пути', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'buyer@example.ru' } });
    const supplier = await prisma.supplier.create({ data: { legalName: 'ООО Т', inn: '7707083893', status: 'active' } });
    await prisma.order.create({
      data: {
        number: '900001', userId: user.id, status: 'paid', paymentStatus: 'succeeded', goodsTotal: 100, deliveryTotal: 0, total: 100, recipientName: 'Е', recipientPhone: '+79990000000',
        recipientEmail: 'buyer@example.ru', expiresAt: new Date(),
        shipments: { create: { no: 1, supplierId: supplier.id, status: 'in_transit', deliveryType: 'pvz', tariffCode: 136, cityCode: 44, address: 'М', deliveryPrice: 0, periodMin: 1, periodMax: 2, goodsTotal: 100, commissionBp: 1000, commission: 10 } },
      },
    });
    const res = await buyer.post('/api/me/delete').set('Origin', ORIGIN).send({ password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/в пути/);
  });

  it('админ: поиск, блокировка без раскрытия аккаунта, выгрузка и удаление; не админу — нет', async () => {
    expect((await buyer.get('/api/admin/users')).status).toBe(403);
    const list = (await admin.get('/api/admin/users?q=buyer')).body;
    expect(list).toHaveLength(1);
    const id = list[0].id;

    await admin.post(`/api/admin/users/${id}/block`).set('Origin', ORIGIN).send({ reason: 'Мошенничество с возвратами' }).expect(200);
    expect((await buyer.get('/api/me/profile')).status).toBe(401);
    const wrong = await agent(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'buyer@example.ru', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    const right = await agent(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'buyer@example.ru', password: PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body.code).toBe('blocked');

    await admin.post(`/api/admin/users/${id}/unblock`).set('Origin', ORIGIN).expect(200);
    expect((await agent(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'buyer@example.ru', password: PASSWORD })).status).toBe(200);

    expect((await admin.get(`/api/admin/users/${id}/export`)).body.account.email).toBe('buyer@example.ru');
    await admin.post(`/api/admin/users/${id}/delete`).set('Origin', ORIGIN).expect(200);
    expect((await admin.get('/api/admin/users?q=buyer')).body).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: { in: ['user.block', 'user.export', 'user.delete.admin'] } } })).toBe(3);
  });

  it('фото удаляются после 12 месяцев без активности', async () => {
    const file = await photoPath();
    expect(await app.get(PrivacyService).expirePhotos()).toMatchObject({ photos: 0 });
    await prisma.user.updateMany({ where: { email: 'buyer@example.ru' }, data: { lastActiveAt: new Date(Date.now() - 366 * 86400000) } });
    expect(await app.get(PrivacyService).expirePhotos()).toMatchObject({ photos: 1, users: 1 });
    expect(existsSync(file)).toBe(false);
    expect(await prisma.buyerProfile.count()).toBe(1);
  });
});
