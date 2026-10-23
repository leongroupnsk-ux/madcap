import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { SettingsService } from '../src/common/settings.service';
import { ORIGIN, PASSWORD, agent, bootApp, mails, makeSupplier, makeUser, resetDb, tokenFrom, type Agent } from './helpers';

describe('админка: роли сотрудников, журнал, настройки платформы', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Agent;

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
  });

  /** Приглашение → письмо → установка пароля по ссылке → сессия сотрудника */
  async function invite(email: string, staffRole: string) {
    await owner.post('/api/admin/system/staff').set('Origin', ORIGIN).send({ email, staffRole }).expect(201);
    const mail = mails(app).filter((m) => m.to === email).at(-1)!;
    expect(mail.subject).toMatch(/админку/);
    const a = agent(app);
    await a.post('/api/auth/reset-password').set('Origin', ORIGIN).send({ token: tokenFrom(mail.text), password: PASSWORD, passwordRepeat: PASSWORD }).expect(200);
    return a;
  }

  it('роль ограничивает разделы; смена роли и отзыв доступа; владелец остаётся всегда', async () => {
    const support = await invite('support@example.ru', 'support');
    expect((await support.get('/api/auth/me')).body.user.staffRole).toBe('support');
    expect((await support.get('/api/admin/orders')).status).toBe(200);
    expect((await support.get('/api/admin/users')).status).toBe(200);
    expect((await support.get('/api/admin/dictionaries')).status).toBe(403);
    expect((await support.get('/api/admin/moderation')).status).toBe(403);
    expect((await support.get('/api/admin/system/staff')).status).toBe(403);

    const staff = (await owner.get('/api/admin/system/staff')).body;
    const sup = staff.find((u: any) => u.email === 'support@example.ru');
    await owner.put(`/api/admin/system/staff/${sup.id}`).set('Origin', ORIGIN).send({ staffRole: 'editor' }).expect(200);
    expect((await support.get('/api/admin/dictionaries')).status).toBe(200);
    expect((await support.get('/api/admin/orders')).status).toBe(403);

    // Себя владелец не понижает и не отзывает
    const me = staff.find((u: any) => u.email === 'owner@example.ru');
    expect((await owner.put(`/api/admin/system/staff/${me.id}`).set('Origin', ORIGIN).send({ staffRole: 'support' })).status).toBe(400);
    expect((await owner.post(`/api/admin/system/staff/${me.id}/revoke`).set('Origin', ORIGIN)).status).toBe(400);

    await owner.post(`/api/admin/system/staff/${sup.id}/revoke`).set('Origin', ORIGIN).expect(200);
    expect((await support.get('/api/admin/dictionaries')).status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: sup.id } })).role).toBe('buyer');

    const log = (await owner.get('/api/admin/system/audit?action=staff.')).body;
    expect(log.map((r: any) => r.action)).toEqual(['staff.revoke', 'staff.role', 'staff.invite']);
    expect(log[0].actor).toBe('owner@example.ru');
  });

  it('настройки: срок оплаты, срок подтверждения и комиссия новых поставщиков', async () => {
    expect((await owner.get('/api/admin/system/settings')).body).toMatchObject({ defaultCommissionPct: 10, payMinutes: 30, confirmHours: 48 });
    expect((await owner.put('/api/admin/system/settings').set('Origin', ORIGIN).send({ defaultCommissionPct: 12.5, confirmHours: 5, payMinutes: 15 })).status).toBe(400);
    await owner.put('/api/admin/system/settings').set('Origin', ORIGIN).send({ defaultCommissionPct: 12.5, confirmHours: 24, payMinutes: 15 }).expect(200);
    expect(await app.get(SettingsService).get()).toMatchObject({ payMinutes: 15, confirmHours: 24 });

    const { supplierId } = await makeSupplier(app, owner, 'new@sup.ru', '7707083893');
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } })).commissionBp).toBe(1250);
    expect((await owner.get('/api/admin/system/audit?action=settings')).body[0].data.after.payMinutes).toBe(15);
  });
});
