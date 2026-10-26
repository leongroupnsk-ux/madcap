import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetTwoFactor } from '../src/auth/reset-2fa';
import { totpCode } from '../src/auth/totp';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, PASSWORD, agent, bootApp, makeUser, resetDb, type Agent } from './helpers';

describe('обязательная 2FA для сотрудников админки', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  /** Включение 2FA через API так же, как это делает страница /admin/security */
  async function enable2fa(a: Agent) {
    const setup = (await a.post('/api/auth/totp/setup').set('Origin', ORIGIN).expect(201)).body as { secret: string };
    const res = await a.post('/api/auth/totp/enable').set('Origin', ORIGIN).send({ code: totpCode(setup.secret) }).expect(200);
    return { secret: setup.secret, user: res.body.user };
  }

  it('владелец без 2FA получает twofa_setup_required, включает 2FA — и доступ открывается', async () => {
    const login = agent(app);
    await prisma.user.create({ data: { email: 'owner@example.ru', role: 'admin', emailVerifiedAt: new Date(), passwordHash: await argon2.hash(PASSWORD) } });
    const res = await login.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'owner@example.ru', password: PASSWORD }).expect(200);
    // Клиент по этому флагу сразу ведёт на страницу включения 2FA
    expect(res.body.user.twofaSetupRequired).toBe(true);

    const blocked = await login.get('/api/admin/orders');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('twofa_setup_required');
    expect((await login.get('/api/admin/system/staff')).body.code).toBe('twofa_setup_required');
    // /me и включение 2FA доступны
    expect((await login.get('/api/auth/me').expect(200)).body.user).toMatchObject({ staffRole: 'owner', totpEnabled: false, twofaSetupRequired: true });

    const { user, secret } = await enable2fa(login);
    expect(user).toMatchObject({ totpEnabled: true, twofaSetupRequired: false });
    expect((await login.get('/api/admin/orders')).status).toBe(200);
    expect((await login.get('/api/auth/me')).body.user.twofaSetupRequired).toBe(false);

    // Отключить обязательную 2FA нельзя — иначе админка снова закроется
    const off = await login.post('/api/auth/totp/disable').set('Origin', ORIGIN).send({ code: totpCode(secret) });
    expect(off.status).toBe(400);
    expect(off.body.code).toBe('twofa_required_by_policy');

    const log = (await login.get('/api/admin/system/audit?action=auth.2fa')).body;
    expect(log.map((r: { action: string }) => r.action)).toEqual(['auth.2fa.enable']);

    // Выход работает и без 2FA (проверен отдельно на пользователе, которому она обязательна)
    const other = await makeUser(app, 'owner2@example.ru', 'admin', { twofa: false });
    await other.post('/api/auth/logout').set('Origin', ORIGIN).expect(204);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });

  it('сотрудник роли не из списка работает без 2FA; список меняется в настройках с записью в журнал', async () => {
    const owner = await makeUser(app, 'owner@example.ru', 'admin');
    const support = await makeUser(app, 'support@example.ru', 'admin', { twofa: false });
    await prisma.user.update({ where: { email: 'support@example.ru' }, data: { staffRole: 'support' } });
    expect((await support.get('/api/admin/orders')).status).toBe(200);
    expect((await support.get('/api/auth/me')).body.user.twofaSetupRequired).toBe(false);
    // Поддержке настройки безопасности не видны
    expect((await support.get('/api/admin/system/settings/security')).status).toBe(403);

    expect((await owner.get('/api/admin/system/settings/security').expect(200)).body).toEqual({ require2faRoles: ['owner'] });
    // Владельца из списка убрать нельзя
    expect((await owner.put('/api/admin/system/settings/security').set('Origin', ORIGIN).send({ require2faRoles: ['support'] })).status).toBe(400);
    await owner.put('/api/admin/system/settings/security').set('Origin', ORIGIN).send({ require2faRoles: ['owner', 'support', 'support'] }).expect(200);
    expect((await owner.get('/api/admin/system/settings/security')).body).toEqual({ require2faRoles: ['owner', 'support'] });

    const blocked = await support.get('/api/admin/orders');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('twofa_setup_required');
    await enable2fa(support);
    expect((await support.get('/api/admin/orders')).status).toBe(200);

    const log = (await owner.get('/api/admin/system/audit?action=settings.security')).body;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: 'owner@example.ru', data: { before: { require2faRoles: ['owner'] }, after: { require2faRoles: ['owner', 'support'] } } });
  });

  it('покупатель и поставщик 2FA не касается', async () => {
    const buyer = await makeUser(app, 'buyer@example.ru');
    expect((await buyer.get('/api/auth/me')).body.user.twofaSetupRequired).toBe(false);
    expect((await buyer.get('/api/admin/orders')).status).toBe(403);
    expect((await buyer.get('/api/admin/orders')).body.code).toBeUndefined();
  });

  it('аварийный сброс 2FA: выключает 2FA, закрывает сессии, пишет в журнал', async () => {
    const owner = await makeUser(app, 'owner@example.ru', 'admin');
    expect((await owner.get('/api/admin/orders')).status).toBe(200);

    const r = await resetTwoFactor(prisma, ' Owner@Example.ru ');
    expect(r).toMatchObject({ email: 'owner@example.ru', hadTwoFactor: true, sessionsClosed: 1 });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.ru' } });
    expect(u.totpEnabledAt).toBeNull();
    expect(u.totpSecret).toBeNull();
    expect((await owner.get('/api/auth/me')).status).toBe(401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.2fa.reset' } });
    expect(audit).toMatchObject({ actorId: null, entityId: u.id });

    // Вход по паролю без кода, затем — только настройка 2FA
    const again = agent(app);
    expect((await again.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'owner@example.ru', password: PASSWORD }).expect(200)).body.user.twofaSetupRequired).toBe(true);
    expect((await again.get('/api/admin/orders')).body.code).toBe('twofa_setup_required');

    await expect(resetTwoFactor(prisma, 'nobody@example.ru')).rejects.toThrow(/не найден/);
  });
});
