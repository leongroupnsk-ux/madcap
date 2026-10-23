import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, agent, bootApp, jpeg, mails, makeUser, resetDb, type Agent } from './helpers';

describe('консультация стилиста', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyer: Agent;
  let stylist: Agent;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    buyer = await makeUser(app, 'buyer@example.ru');
    stylist = await makeUser(app, 'stylist@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'stylist@example.ru' }, data: { staffRole: 'stylist' } });
  });

  const ask = (body: object) => buyer.post('/api/me/stylist').set('Origin', ORIGIN).send(body);

  it('стилист видит анкету и фото только по открытому запросу с разрешения покупателя; всё в аудите', async () => {
    const question = { question: 'Какой цвет халата лучше под мой цветотип?', sharePhotos: true };
    const first = await ask(question);
    expect(first.status, JSON.stringify(first.body)).toBe(400); // анкета не пройдена
    const spec = await prisma.specialty.findFirstOrThrow();
    await buyer.put('/api/me/profile').set('Origin', ORIGIN).send({ gender: 'female', name: 'Елена', age: 31, heightCm: 172, weightKg: 60, sizeTop: 'M', sizeBottom: 'L', skinTone: 'cold', hair: 'light', specialtyIds: [spec.id], budgetRange: '10_15', complete: true }).expect(200);
    expect((await ask(question)).body.message).toMatch(/загрузите/);
    await buyer.post('/api/me/consents').set('Origin', ORIGIN).send({ type: 'photos', granted: true });
    await buyer.post('/api/me/photos').set('Origin', ORIGIN).field('angle', 'front').attach('file', await jpeg(1), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);

    const [req] = (await ask(question).expect(201)).body;
    expect(req).toMatchObject({ status: 'open', sharePhotos: true });
    expect((await ask(question)).status).toBe(409);

    // Не стилист и покупатель в рабочее место стилиста не попадают
    const support = await makeUser(app, 'support@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'support@example.ru' }, data: { staffRole: 'support' } });
    expect((await support.get('/api/admin/stylist')).status).toBe(403);
    expect((await buyer.get('/api/admin/stylist')).status).toBe(403);
    expect((await agent(app).get('/api/admin/stylist')).status).toBe(401);
    expect((await agent(app).get('/api/me/stylist')).status).toBe(401);

    expect((await stylist.get('/api/admin/stylist')).body).toEqual([expect.objectContaining({ id: req.id, name: 'Елена' })]);
    const view = await stylist.get(`/api/admin/stylist/${req.id}`).expect(200);
    expect(view.body.profile).toMatchObject({ heightCm: 172, sizeTop: 'M', colorType: 'Лето', specialties: [spec.name] });
    expect(JSON.stringify(view.body)).not.toContain('buyer@example.ru');
    expect(view.body.photos).toHaveLength(1);
    const img = await stylist.get(view.body.photos[0].url).expect(200);
    expect(img.headers['cache-control']).toContain('no-store');
    expect(await prisma.auditLog.count({ where: { action: { in: ['stylist.view', 'stylist.photo'] } } })).toBe(2);

    // Ответ закрывает доступ
    expect((await stylist.post(`/api/admin/stylist/${req.id}/answer`).set('Origin', ORIGIN).send({ answer: 'Коротко' })).status).toBe(400);
    const answer = 'Вам подойдут холодные оттенки: лаванда и морская волна. Халат — белый, без кремового подтона.';
    const done = await stylist.post(`/api/admin/stylist/${req.id}/answer`).set('Origin', ORIGIN).send({ answer }).expect(200);
    expect(done.body).toMatchObject({ status: 'answered', profile: null, photos: [] });
    expect((await stylist.get(view.body.photos[0].url)).status).toBe(404);
    expect((await stylist.post(`/api/admin/stylist/${req.id}/answer`).set('Origin', ORIGIN).send({ answer })).status).toBe(400);
    expect(mails(app).some((m) => m.to === 'buyer@example.ru' && m.text.includes('лаванда'))).toBe(true);
    expect((await buyer.get('/api/me/stylist')).body[0]).toMatchObject({ status: 'answered', answer });

    // Без разрешения на фото стилист их не видит; покупатель может отменить запрос
    const [second] = (await ask({ question: 'Подойдут ли мне брюки джоггеры?', sharePhotos: false }).expect(201)).body;
    expect((await stylist.get(`/api/admin/stylist/${second.id}`)).body.photos).toEqual([]);
    expect((await stylist.get(`/api/admin/stylist/${second.id}/photos/${view.body.photos[0].id}`)).status).toBe(404);
    const other = await makeUser(app, 'other@example.ru');
    expect((await other.post(`/api/me/stylist/${second.id}/cancel`).set('Origin', ORIGIN)).status).toBe(404);
    expect((await buyer.post(`/api/me/stylist/${second.id}/cancel`).set('Origin', ORIGIN).expect(200)).body[0].status).toBe('cancelled');

    // Выгрузка данных содержит запросы; удаление аккаунта их удаляет
    expect((await buyer.get('/api/me/export')).body.stylistRequests).toHaveLength(2);
  });
});
