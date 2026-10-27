import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MailTemplateSaveInput } from '@aesculap/shared';
import type { User } from '@prisma/client';
import { config } from '../config';
import { AuditService } from './audit.service';
import { MAIL_TEMPLATES, GLOBAL_VARS, renderTemplate, validateTemplate, type MailTemplateDef, type MailTemplateKey, type MailVars } from './mail-templates';
import { MailService } from './mail.service';
import { PrismaService } from './prisma.service';

const isKey = (k: string): k is MailTemplateKey => Object.prototype.hasOwnProperty.call(MAIL_TEMPLATES, k);

/**
 * Письма через реестр шаблонов: текст по умолчанию — из кода (mail-templates.ts), переопределение — из
 * таблицы mail_templates. Переопределения читаются целиком (их единицы) с кэшем в процессе на 30 секунд;
 * в процессе, который сохранил шаблон, кэш сбрасывается сразу.
 */
@Injectable()
export class MailTemplatesService {
  private readonly logger = new Logger('MailTemplates');
  private cache: { value: Map<string, { subject: string; text: string; updatedAt: Date }>; until: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  invalidate() {
    this.cache = null;
  }

  private async overrides() {
    if (this.cache && this.cache.until > Date.now()) return this.cache.value;
    const rows = await this.prisma.mailTemplate.findMany();
    const value = new Map(rows.filter((r) => isKey(r.key)).map((r) => [r.key, { subject: r.subject, text: r.text, updatedAt: r.updatedAt }]));
    this.cache = { value, until: Date.now() + 30_000 };
    return value;
  }

  private globals() {
    return { brand: config.brandName, site: config.webOrigin };
  }

  /** Тема и текст письма K с подстановкой переменных */
  async render<K extends MailTemplateKey>(key: K, vars: MailVars<K>) {
    const d = MAIL_TEMPLATES[key] as MailTemplateDef;
    const o = (await this.overrides()).get(key);
    return renderTemplate(o?.subject ?? d.subject, o?.text ?? d.text, { ...this.globals(), ...(vars as Record<string, string | number | null | undefined>) });
  }

  /** Отправить письмо по шаблону. headers — List-Unsubscribe у рассылок. */
  async send<K extends MailTemplateKey>(key: K, to: string, vars: MailVars<K>, opts: { headers?: Record<string, string> } = {}) {
    const { subject, text } = await this.render(key, vars);
    await this.mail.send({ to, subject, text, headers: opts.headers });
  }

  // ─── админка ─────────────────────────────────────────────────────────

  private def(key: string) {
    if (!isKey(key)) throw new NotFoundException({ message: 'Шаблон не найден' });
    return { key, d: MAIL_TEMPLATES[key] as MailTemplateDef };
  }

  async list() {
    const o = await this.overrides();
    return Object.entries(MAIL_TEMPLATES as Record<string, MailTemplateDef>).map(([key, d]) => ({
      key, group: d.group, title: d.title, description: d.description, customized: o.has(key), updatedAt: o.get(key)?.updatedAt ?? null,
    }));
  }

  async view(key: string) {
    const { d } = this.def(key);
    const o = (await this.overrides()).get(key);
    return {
      key, group: d.group, title: d.title, description: d.description,
      vars: [...Object.entries(d.vars).map(([name, label]) => ({ name, label, required: d.required.includes(name) })), ...Object.entries(GLOBAL_VARS).map(([name, label]) => ({ name, label, required: false }))],
      subject: o?.subject ?? d.subject, text: o?.text ?? d.text,
      defaultSubject: d.subject, defaultText: d.text,
      customized: Boolean(o), updatedAt: o?.updatedAt ?? null,
    };
  }

  private check(key: MailTemplateKey, input: MailTemplateSaveInput) {
    const errors = validateTemplate(key, input.subject, input.text);
    if (Object.keys(errors).length) throw new BadRequestException({ message: Object.values(errors)[0], errors });
  }

  async save(key: string, input: MailTemplateSaveInput, actor: User) {
    const { key: k, d } = this.def(key);
    this.check(k, input);
    const before = (await this.overrides()).get(k);
    // Совпадает с текстом по умолчанию — хранить нечего
    if (input.subject === d.subject && input.text === d.text) await this.prisma.mailTemplate.deleteMany({ where: { key: k } });
    else await this.prisma.mailTemplate.upsert({ where: { key: k }, update: { subject: input.subject, text: input.text, updatedById: actor.id }, create: { key: k, subject: input.subject, text: input.text, updatedById: actor.id } });
    this.invalidate();
    await this.audit.log(actor.id, 'mail_template.update', 'mail_template', k, {
      before: before ? { subject: before.subject, text: before.text } : 'default',
      after: { subject: input.subject, text: input.text },
    });
    return this.view(k);
  }

  async reset(key: string, actor: User) {
    const { key: k } = this.def(key);
    const r = await this.prisma.mailTemplate.deleteMany({ where: { key: k } });
    this.invalidate();
    if (r.count) await this.audit.log(actor.id, 'mail_template.reset', 'mail_template', k);
    return this.view(k);
  }

  /** Предпросмотр на тестовых данных: сохранённый текст или черновик из формы (с той же проверкой, что при сохранении) */
  async preview(key: string, draft?: MailTemplateSaveInput) {
    const { key: k, d } = this.def(key);
    if (draft) this.check(k, draft);
    const src = draft ?? (await this.view(k));
    return renderTemplate(src.subject, src.text, { ...this.globals(), ...d.sample });
  }

  /** Тестовое письмо себе: тестовые данные, тема с пометкой [Тест] */
  async test(key: string, draft: MailTemplateSaveInput | undefined, actor: User) {
    const { key: k } = this.def(key);
    const p = await this.preview(k, draft);
    await this.mail.send({ to: actor.email, subject: `[Тест] ${p.subject}`, text: p.text });
    await this.audit.log(actor.id, 'mail_template.test', 'mail_template', k, { to: actor.email });
    this.logger.log(`Тестовое письмо ${k} → ${actor.email}`);
    return { ok: true, to: actor.email };
  }
}
