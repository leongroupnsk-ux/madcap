import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAIL_TEMPLATES, GLOBAL_VARS, renderTemplate, tokensOf, validateTemplate, type MailTemplateKey } from '../src/common/mail-templates';
import { PrismaService } from '../src/common/prisma.service';
import { ORIGIN, agent, bootApp, mails, makeUser, resetDb, type Agent } from './helpers';

describe('шаблоны писем: реестр, переопределение из админки, проверки, аудит', () => {
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

  it('реестр: тексты по умолчанию проходят собственную проверку, тестовые данные покрывают все переменные', () => {
    for (const key of Object.keys(MAIL_TEMPLATES) as MailTemplateKey[]) {
      const d = MAIL_TEMPLATES[key];
      expect(validateTemplate(key, d.subject, d.text), key).toEqual({});
      const vars = new Set([...tokensOf(d.subject), ...tokensOf(d.text)]);
      for (const v of vars) expect(v in d.vars || v in GLOBAL_VARS, `${key}: {{${v}}}`).toBe(true);
      for (const v of Object.keys(d.vars)) expect(d.sample, `${key}: пример для ${v}`).toHaveProperty([v]);
    }
    // Пустые блоки схлопываются, переводы строк в теме убираются
    expect(renderTemplate('Тема {{a}}', 'Строка\n\n{{a}}\n\n{{b}}\n\nконец', { a: 'x\ny', b: '' })).toEqual({ subject: 'Тема x y', text: 'Строка\n\nx\ny\n\nконец' });
  });

  it('доступ только владельцу: модератор, редактор и поддержка получают 403', async () => {
    for (const [email, staffRole] of [['m@example.ru', 'moderator'], ['e@example.ru', 'editor'], ['s@example.ru', 'support']] as const) {
      const a = await makeUser(app, email, 'admin');
      await prisma.user.update({ where: { email }, data: { staffRole } });
      expect((await a.get('/api/admin/system/mail-templates')).status, staffRole).toBe(403);
    }
    expect((await agent(app).get('/api/admin/system/mail-templates')).status).toBe(401);
    const list = (await owner.get('/api/admin/system/mail-templates').expect(200)).body as { key: string; customized: boolean }[];
    expect(list.map((t) => t.key)).toEqual(expect.arrayContaining(['auth.password_reset', 'order.paid', 'newsletter.promotion', 'review.invite', 'order.payment_link', 'premium.lead_manager']));
    expect(list.every((t) => !t.customized)).toBe(true);
    expect((await owner.get('/api/admin/system/mail-templates/nope')).status).toBe(404);
  });

  it('проверки: неизвестная переменная, удалённая обязательная, HTML, незакрытая скобка', async () => {
    const put = (key: string, body: { subject: string; text: string }) => owner.put(`/api/admin/system/mail-templates/${key}`).set('Origin', ORIGIN).send(body);
    let r = await put('auth.password_reset', { subject: 'Сброс пароля {{brand}}', text: 'Ссылка: {{link}}, заказ {{order.number}}' });
    expect(r.status).toBe(400);
    expect(r.body.errors.text).toMatch(/Неизвестные переменные: \{\{order\.number\}\}/);
    r = await put('newsletter.promotion', { subject: '{{promotion.name}}', text: 'Скидки по акции {{promotion.name}}! Без отписки.' });
    expect(r.status).toBe(400);
    expect(r.body.errors.text).toMatch(/Обязательные.*\{\{unsubscribeUrl\}\}/);
    r = await put('auth.password_reset', { subject: 'Сброс пароля', text: 'Нажмите <a href="https://evil.example">сюда</a> {{link}}' });
    expect(r.status).toBe(400);
    expect(r.body.errors.text).toMatch(/HTML/);
    r = await put('auth.password_reset', { subject: 'Сброс пароля', text: 'Ссылка: {{link}} и {{minutes' });
    expect(r.status).toBe(400);
    expect(r.body.errors.text).toMatch(/Незакрытая/);
    r = await put('auth.password_reset', { subject: 'Две\nстроки', text: 'Ссылка: {{link}}' });
    expect(r.status).toBe(400);
    expect(await prisma.mailTemplate.count()).toBe(0);
  });

  it('переопределение используется при отправке; предпросмотр, тестовое письмо себе, сброс к стандартному; всё в аудите', async () => {
    await makeUser(app, 'buyer@example.ru');
    const body = { subject: 'Новый пароль для {{brand}}', text: 'Здравствуйте!\nСсылка для нового пароля: {{link}}\nДействует {{minutes}} мин.' };

    const preview = await owner.post('/api/admin/system/mail-templates/auth.password_reset/preview').set('Origin', ORIGIN).send(body).expect(200);
    expect(preview.body.text).toContain('https://example.ru/reset-password?token=TEST');
    expect(await prisma.mailTemplate.count()).toBe(0);

    const saved = await owner.put('/api/admin/system/mail-templates/auth.password_reset').set('Origin', ORIGIN).send(body).expect(200);
    expect(saved.body).toMatchObject({ customized: true, subject: body.subject });
    expect(saved.body.vars.find((v: { name: string }) => v.name === 'link')).toMatchObject({ required: true });

    await agent(app).post('/api/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'buyer@example.ru' }).expect((res) => expect(res.status).toBeLessThan(300));
    const letter = mails(app).filter((m) => m.to === 'buyer@example.ru').at(-1)!;
    expect(letter.subject).toBe('Новый пароль для aesculap');
    expect(letter.text).toMatch(/^Здравствуйте!\nСсылка для нового пароля: http:\/\/localhost:4000\/reset-password\?token=[\w-]+\nДействует \d+ мин\.$/);

    const test = await owner.post('/api/admin/system/mail-templates/auth.password_reset/test').set('Origin', ORIGIN).send(body).expect(200);
    expect(test.body.to).toBe('owner@example.ru');
    expect(mails(app).at(-1)).toMatchObject({ to: 'owner@example.ru', subject: '[Тест] Новый пароль для aesculap' });

    const reset = await owner.delete('/api/admin/system/mail-templates/auth.password_reset').set('Origin', ORIGIN).expect(200);
    expect(reset.body.customized).toBe(false);
    expect(reset.body.subject).toBe(MAIL_TEMPLATES['auth.password_reset'].subject);
    await agent(app).post('/api/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'buyer@example.ru' });
    expect(mails(app).filter((m) => m.to === 'buyer@example.ru').at(-1)!.subject).toBe('Восстановление пароля — aesculap');

    const actions = (await prisma.auditLog.findMany({ where: { entity: 'mail_template' }, orderBy: { at: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['mail_template.update', 'mail_template.test', 'mail_template.reset']);
    const upd = await prisma.auditLog.findFirstOrThrow({ where: { action: 'mail_template.update' } });
    expect(upd.data).toMatchObject({ before: 'default', after: { subject: body.subject } });
  });
});
