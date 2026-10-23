import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, agent, bootApp, makeUser, resetDb, type Agent } from './helpers';

describe('юридические страницы из админки', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;

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
  });

  it('версии: публикация, очистка HTML, версия в согласии, доступ только владельцу', async () => {
    expect((await agent(app).get('/api/legal/privacy')).status).toBe(404);
    expect((await agent(app).get('/api/legal/unknown')).status).toBe(404);
    const body = `<h2>1. Оператор</h2><p onclick="x()">Оператор — [OPERATOR_NAME].</p><script>alert(1)</script><img src="https://evil/x.png"><p>${'Текст политики. '.repeat(20)}</p>`;
    expect((await admin.post('/api/admin/legal/privacy').set('Origin', ORIGIN).send({ title: 'Политика', html: '<p>Коротко</p>' })).status).toBe(400);
    const h = (await admin.post('/api/admin/legal/privacy').set('Origin', ORIGIN).send({ title: 'Политика обработки ПДн', html: body, note: 'Правки юриста' }).expect(201)).body;
    expect(h[0]).toMatchObject({ version: 1, note: 'Правки юриста', by: 'admin@example.ru' });
    expect(h[0].html).not.toMatch(/script|onclick|img/);
    expect(h[0].html).toContain('[OPERATOR_NAME]');
    expect((await admin.post('/api/admin/legal/privacy').set('Origin', ORIGIN).send({ title: 'Политика обработки ПДн', html: body })).status).toBe(400);

    const pub = (await agent(app).get('/api/legal/privacy').expect(200)).body;
    expect(pub.version).toMatch(/^\d{4}-\d{2}-\d{2}\/r1$/);

    // Согласие на ПДн при регистрации пишется с версией из админки, оферта — из кода
    await agent(app).post('/api/auth/register').set('Origin', ORIGIN).send({ email: 'new@example.ru', password: 'Secret-pass-123', passwordRepeat: 'Secret-pass-123', acceptTerms: true }).expect(201);
    const consents = await prisma.consent.findMany({ where: { user: { email: 'new@example.ru' } } });
    expect(consents.find((c) => c.type === 'pdn')?.version).toBe(pub.version);
    expect(consents.find((c) => c.type === 'offer')?.version).toBe('2026-10-22');

    await admin.post('/api/admin/legal/privacy').set('Origin', ORIGIN).send({ title: 'Политика обработки ПДн', html: `${body}<p>Новый пункт.</p>` }).expect(201);
    const list = (await admin.get('/api/admin/legal')).body;
    expect(list.find((d: { slug: string }) => d.slug === 'privacy').version).toMatch(/r2$/);
    expect(list.find((d: { slug: string }) => d.slug === 'offer').version).toBeNull();

    const editor = await makeUser(app, 'editor@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'editor@example.ru' }, data: { staffRole: 'editor' } });
    expect((await editor.get('/api/admin/legal')).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'legal.publish' } })).toBe(2);
  });
});
