import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/common/prisma.service';
import { config } from '../src/config';
import { TelegramService, type TgMessage } from '../src/notifications/telegram.service';
import { ORIGIN, PASSWORD, agent, bootApp, mails, makeSupplier, makeUser, resetDb, type Agent } from './helpers';

/**
 * Переписка по премиум-заявке: привязка Telegram по одноразовой ссылке, входящие из бота, ответы менеджера,
 * заметки о WhatsApp, права и ПДн. Bot API замокан (api() подменён) — сети в тестах нет.
 */
describe('премиум: переписка Telegram / WhatsApp', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tg: TelegramService;
  let admin: Agent;
  let supplierId: string;
  /** Вызовы Bot API: метод и тело */
  let calls: { method: string; body: Record<string, unknown> }[];
  let failSend: string | null;
  let updateId = 0;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    tg = app.get(TelegramService);
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, 'admin@example.ru', 'admin');
    ({ supplierId } = await makeSupplier(app, admin, 'owner@sup.ru', '7707083893'));
    await prisma.supplier.update({ where: { id: supplierId }, data: { payoutStatus: 'active' } });
    calls = [];
    failSend = null;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    tg.enabled = false;
    tg.username = '';
    tg.sent.length = 0;
    config.alertEmail = '';
  });
  afterAll(async () => {
    await app.close();
  });

  /** Включить бота с замоканным Bot API */
  function enableBot() {
    tg.enabled = true;
    tg.username = 'aesculap_test_bot';
    vi.spyOn(tg, 'api').mockImplementation(async <T,>(method: string, body: object) => {
      calls.push({ method, body: body as Record<string, unknown> });
      if (method === 'sendMessage' && failSend) throw new Error(failSend);
      return {} as T;
    });
  }
  const sentTo = (chatId: string) => calls.filter((c) => c.method === 'sendMessage' && c.body.chat_id === chatId).map((c) => String(c.body.text));
  const update = (chatId: number, m: Partial<TgMessage>) => tg.handleUpdate({ update_id: ++updateId, message: { chat: { id: chatId, type: 'private' }, ...m } });

  async function catalog() {
    const brand = await prisma.brand.create({ data: { name: 'МедТекс', slug: 'medteks' } });
    for (const [slug, name, slot] of [['topy', 'Топы', 'top'], ['bryuki', 'Брюки', 'pants']] as const) {
      await prisma.category.upsert({ where: { slug }, update: { slot }, create: { slug, name, slot } });
    }
    const color = await prisma.color.upsert({ where: { name: 'Тёмно-синий' }, update: {}, create: { name: 'Тёмно-синий', hex: '#1F2A4D', colorFamily: 'blue' } });
    let n = 0;
    for (const [title, cat, size] of [['Топ «Уют»', 'topy', 'M'], ['Брюки «Уют»', 'bryuki', 'L']] as const) {
      n += 1;
      const c = await prisma.category.findUniqueOrThrow({ where: { slug: cat } });
      await prisma.product.create({
        data: {
          supplierId, brandId: brand.id, categoryId: c.id, title, slug: `pm-${n}-${Date.now()}`, gender: 'unisex', moderationStatus: 'published', publishedAt: new Date(), premium: true,
          variants: { create: [{ sku: `PM${n}`, size, heightRange: null, colorId: color.id, price: 450000, stock: 5 }] },
        },
      });
    }
  }
  const answers = async () => ({
    gender: 'female', name: 'Елена', age: 31, heightCm: 172, weightKg: 60, sizeTop: 'M', sizeBottom: 'L', sizeShoes: '38',
    skinTone: 'cold', hair: 'light', eyes: 'light', specialtyGroupIds: [(await prisma.specialtyGroup.findFirstOrThrow()).id], budgetRange: 'gt30',
  });
  /** Заявка напрямую в базе — для проверок ленты без расчёта капсулы */
  const lead = (data: Partial<{ name: string; phone: string; userId: string; telegramChatId: string }> = {}) =>
    prisma.premiumLead.create({
      data: { name: 'Анна', phone: '+79991234567', contact: 'telegram', capsule: { title: 'Капсула', items: [], total: 0 }, answers: {}, telegramLinkedAt: data.telegramChatId ? new Date() : null, ...data },
    });
  const codeOf = (url: string) => new URL(url).searchParams.get('start')!;

  it('без TELEGRAM_BOT_TOKEN способ «telegram» недоступен', async () => {
    expect((await agent(app).get('/api/premium/contact-options')).body).toEqual({ telegram: false });
    const res = await agent(app).post('/api/premium/leads').set('Origin', ORIGIN).send({ name: 'Анна', phone: '+79991234567', contact: 'telegram', consent: true, answers: await answers() });
    expect(res.status).toBe(400);
    expect(res.body.errors.contact).toBeTruthy();
    const l = await lead();
    expect((await admin.post(`/api/admin/premium/${l.id}/telegram-link`).set('Origin', ORIGIN)).status).toBe(400);
    expect((await admin.get(`/api/admin/premium/${l.id}`)).body.telegram).toMatchObject({ available: false, linked: false });
  });

  it('заявка с Telegram: ссылка на экране и в письме, привязка по коду — одноразовая, со сроком, чужой код не подходит', async () => {
    enableBot();
    await catalog();
    expect((await agent(app).get('/api/premium/contact-options')).body).toEqual({ telegram: true });
    const buyer = await makeUser(app, 'buyer@example.ru');
    const res = await buyer.post('/api/premium/leads').set('Origin', ORIGIN).send({ name: 'Елена', phone: '+79991234567', contact: 'telegram', consent: true, answers: await answers() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.telegramUrl).toMatch(/^https:\/\/t\.me\/aesculap_test_bot\?start=lead_[A-Za-z0-9_-]{24}$/);
    const mail = mails(app).find((m) => m.to === 'buyer@example.ru');
    expect(mail?.text).toContain(`Открыть Telegram: ${res.body.telegramUrl}`);
    const start = codeOf(res.body.telegramUrl);
    // Код в базе — только хешем
    const row = await prisma.premiumLead.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.telegramCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.telegramCodeHash).not.toContain(start.slice(5));
    expect(row.telegramCodeExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);

    await update(111, { text: `/start ${start}` });
    const linked = await prisma.premiumLead.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(linked).toMatchObject({ telegramChatId: '111', telegramCodeHash: null });
    expect(sentTo('111').at(-1)).toMatch(/Здравствуйте, Елена!.*Заявка № \d+ на премиум-капсулу привязана/s);

    // Повтор той же ссылки из другого чата — отказ, привязка не меняется
    await update(222, { text: `/start ${start}` });
    expect(sentTo('222').at(-1)).toMatch(/устарела или уже использована/);
    expect((await prisma.premiumLead.findUniqueOrThrow({ where: { id: res.body.id } })).telegramChatId).toBe('111');
    // Выдуманный код — отказ
    await update(223, { text: '/start lead_AAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(sentTo('223').at(-1)).toMatch(/устарела/);
    expect(await prisma.premiumLead.count({ where: { telegramChatId: '223' } })).toBe(0);

    // Истёкший код (7 дней прошли)
    const other = await lead({ name: 'Ольга' });
    const issued = await admin.post(`/api/admin/premium/${other.id}/telegram-link`).set('Origin', ORIGIN).expect(200);
    await prisma.premiumLead.update({ where: { id: other.id }, data: { telegramCodeExpiresAt: new Date(Date.now() - 1000) } });
    await update(333, { text: `/start ${codeOf(issued.body.url)}` });
    expect(sentTo('333').at(-1)).toMatch(/устарела/);
    expect((await prisma.premiumLead.findUniqueOrThrow({ where: { id: other.id } })).telegramChatId).toBeNull();
    // Новая ссылка из админки отменяет прежнюю
    const first = await admin.post(`/api/admin/premium/${other.id}/telegram-link`).set('Origin', ORIGIN).expect(200);
    const second = await admin.post(`/api/admin/premium/${other.id}/telegram-link`).set('Origin', ORIGIN).expect(200);
    await update(334, { text: `/start ${codeOf(first.body.url)}` });
    expect(sentTo('334').at(-1)).toMatch(/устарела/);
    await update(334, { text: `/start ${codeOf(second.body.url)}` });
    expect((await prisma.premiumLead.findUniqueOrThrow({ where: { id: other.id } })).telegramChatId).toBe('334');
    // Групповой чат — не привязывается
    const third = await admin.post(`/api/admin/premium/${(await lead()).id}/telegram-link`).set('Origin', ORIGIN).expect(200);
    await tg.handleUpdate({ update_id: ++updateId, message: { chat: { id: -500, type: 'group' }, text: `/start ${codeOf(third.body.url)}` } });
    expect(await prisma.premiumLead.count({ where: { telegramChatId: '-500' } })).toBe(0);

    // Привязка поставщика (голый /start → код) работает как раньше
    await update(444, { text: '/start' });
    expect(sentTo('444').at(-1)).toMatch(/^Код привязки: \d{6}/);
  });

  it('входящие от привязанного чата — в ленту, фото — отказ, чужой чат игнорируется; письмо менеджеру одно на серию', async () => {
    enableBot();
    config.alertEmail = 'alerts@example.ru';
    const l = await lead({ telegramChatId: '111' });
    await update(111, { text: 'Можно халат на размер больше?' });
    await update(111, { text: 'И доставку в субботу' });
    await update(111, { photo: [{ file_id: 'x' }] });
    expect(sentTo('111').at(-1)).toMatch(/только текст/);
    await update(999, { text: 'Привет' });
    expect(sentTo('999')).toHaveLength(0);

    const msgs = await prisma.premiumLeadMessage.findMany({ where: { leadId: l.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => [m.direction, m.channel, m.status, m.text])).toEqual([
      ['incoming', 'telegram', 'received', 'Можно халат на размер больше?'],
      ['incoming', 'telegram', 'received', 'И доставку в субботу'],
    ]);
    const alerts = mails(app).filter((m) => m.to === 'alerts@example.ru');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toContain('Можно халат на размер больше?');
    expect(alerts[0].text).toContain(`/admin/premium/${l.id}`);

    // Счётчики непрочитанных: в списке, по заявке и для меню
    const list = await admin.get('/api/admin/premium?status=new').expect(200);
    expect(list.body.unreadTotal).toBe(2);
    expect(list.body.items[0]).toMatchObject({ id: l.id, unread: 2, telegramLinked: true });
    expect((await admin.get('/api/admin/premium/unread')).body).toEqual({ count: 2 });
    await admin.post(`/api/admin/premium/${l.id}/read`).set('Origin', ORIGIN).expect(200);
    expect((await admin.get('/api/admin/premium/unread')).body).toEqual({ count: 0 });
    // После прочтения новое сообщение — снова письмо
    await update(111, { text: 'Ещё вопрос' });
    expect(mails(app).filter((m) => m.to === 'alerts@example.ru')).toHaveLength(2);
  });

  it('ответ менеджера в Telegram, ошибка доставки, заметка WhatsApp; лента в карточке', async () => {
    enableBot();
    const l = await lead({ telegramChatId: '111' });
    await update(111, { text: 'Здравствуйте' });
    const ok = await admin.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: 'Добрый день! Халат L есть.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'sent', error: null });
    expect(sentTo('111').at(-1)).toBe('Добрый день! Халат L есть.');
    // Ответ отмечает входящие прочитанными
    expect((await admin.get('/api/admin/premium/unread')).body.count).toBe(0);

    failSend = 'Forbidden: bot was blocked by the user';
    const failed = await admin.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: 'Вы тут?' });
    expect(failed.body).toMatchObject({ status: 'failed', error: 'Forbidden: bot was blocked by the user' });
    failSend = null;

    const before = calls.length;
    const note = await admin.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'whatsapp', text: 'Отправил фото халата' });
    expect(note.body).toMatchObject({ status: 'offline' });
    expect(calls.length).toBe(before);
    expect((await admin.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: '   ' })).status).toBe(400);
    expect((await admin.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'note', text: 'x' })).status).toBe(400);

    const card = await admin.get(`/api/admin/premium/${l.id}`).expect(200);
    expect(card.body.messages.map((m: { direction: string; channel: string; status: string }) => `${m.direction}/${m.channel}/${m.status}`)).toEqual([
      'incoming/telegram/received', 'outgoing/telegram/sent', 'outgoing/telegram/failed', 'outgoing/whatsapp/offline',
    ]);
    expect(card.body.messages[1].staff).toBe('admin@example.ru');
    expect(card.body.telegram).toMatchObject({ available: true, linked: true });
    expect(card.body.whatsappUrl).toBe(
      `https://wa.me/79991234567?text=${encodeURIComponent(`Здравствуйте, Анна! Это менеджер ${config.brandName}, пишу по вашей заявке № ${l.no} на премиум-капсулу.`)}`,
    );
    expect(await prisma.auditLog.count({ where: { action: 'premium.lead.message', entityId: l.id } })).toBe(3);

    // Telegram не привязан — ответить туда нельзя, заметка WhatsApp — можно
    const unlinked = await lead();
    expect((await admin.post(`/api/admin/premium/${unlinked.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: 'Привет' })).status).toBe(400);
    expect((await admin.post(`/api/admin/premium/${unlinked.id}/messages`).set('Origin', ORIGIN).send({ channel: 'whatsapp', text: 'Написал' })).status).toBe(201);
  });

  it('права: только область «premium» (поддержка — да, редактор, покупатель, поставщик, гость — нет)', async () => {
    enableBot();
    const l = await lead({ telegramChatId: '111' });
    const support = await makeUser(app, 'support@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'support@example.ru' }, data: { staffRole: 'support' } });
    expect((await support.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: 'Ответ поддержки' })).status).toBe(201);
    expect((await support.get('/api/admin/premium/unread')).status).toBe(200);
    const editor = await makeUser(app, 'editor@example.ru', 'admin');
    await prisma.user.update({ where: { email: 'editor@example.ru' }, data: { staffRole: 'editor' } });
    const buyer = await makeUser(app, 'buyer@example.ru');
    for (const who of [editor, buyer]) {
      expect((await who.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: 'x' })).status).toBe(403);
      expect((await who.get('/api/admin/premium/unread')).status).toBe(403);
      expect((await who.post(`/api/admin/premium/${l.id}/read`).set('Origin', ORIGIN)).status).toBe(403);
      expect((await who.post(`/api/admin/premium/${l.id}/telegram-link`).set('Origin', ORIGIN)).status).toBe(403);
    }
    expect((await agent(app).get('/api/admin/premium/unread')).status).toBe(401);
    expect(sentTo('111')).toEqual(['Ответ поддержки']);
  });

  it('ПДн: переписка в выгрузке покупателя и удаляется вместе с заявкой при удалении аккаунта', async () => {
    enableBot();
    const buyer = await makeUser(app, 'buyer@example.ru');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'buyer@example.ru' } });
    const l = await lead({ userId: user.id, telegramChatId: '111' });
    await update(111, { text: 'Мой вопрос' });
    await admin.post(`/api/admin/premium/${l.id}/messages`).set('Origin', ORIGIN).send({ channel: 'telegram', text: 'Ответ менеджера' }).expect(201);
    const exp = await buyer.get('/api/me/export').expect(200);
    expect(exp.body.premiumLeads[0].messages).toEqual([
      expect.objectContaining({ direction: 'от вас', channel: 'telegram', text: 'Мой вопрос' }),
      expect.objectContaining({ direction: 'от менеджера', channel: 'telegram', text: 'Ответ менеджера' }),
    ]);
    // Сотрудник в выгрузке не раскрывается
    expect(JSON.stringify(exp.body)).not.toContain('admin@example.ru');

    await buyer.post('/api/me/delete').set('Origin', ORIGIN).send({ password: PASSWORD }).expect(200);
    expect(await prisma.premiumLead.count({ where: { id: l.id } })).toBe(0);
    expect(await prisma.premiumLeadMessage.count({ where: { leadId: l.id } })).toBe(0);
    // Чат больше не привязан ни к одной заявке — новые сообщения не сохраняются
    await update(111, { text: 'Ещё' });
    expect(await prisma.premiumLeadMessage.count()).toBe(0);
  });
});
