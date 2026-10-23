import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CONSENT_DOC, CONSENT_VERSIONS, LEGAL_DOCS, type ConsentType, type LegalPublish, type LegalSlug } from '@aesculap/shared';
import type { User } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

/** Белый список HTML юридических текстов: структура документа и ссылки, без картинок и стилей */
export function cleanLegal(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a', 'br', 'blockquote'],
    allowedAttributes: { a: ['href', 'rel', 'target'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    transformTags: { b: 'strong', i: 'em' },
  }).trim();
}

const isSlug = (s: string): s is LegalSlug => Object.hasOwn(LEGAL_DOCS, s);

/**
 * Юридические страницы из админки (ТЗ §8, §11): каждая публикация — новая неизменяемая версия.
 * Версия документа пишется в согласие, чтобы было видно, с каким текстом человек согласился.
 */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  slug(s: string): LegalSlug {
    if (!isSlug(s)) throw new NotFoundException();
    return s;
  }

  current(slug: LegalSlug) {
    return this.prisma.legalVersion.findFirst({ where: { slug }, orderBy: { version: 'desc' } });
  }

  label(v: { version: number; publishedAt: Date }) {
    return `${v.publishedAt.toISOString().slice(0, 10)}/r${v.version}`;
  }

  /** Версия текста для согласия: опубликованная из админки, иначе — черновик из кода */
  async consentVersion(type: ConsentType): Promise<string> {
    const v = await this.current(CONSENT_DOC[type]);
    return v ? this.label(v) : CONSENT_VERSIONS[type];
  }

  async overview() {
    const rows = await this.prisma.legalVersion.findMany({ orderBy: { version: 'desc' }, distinct: ['slug'] });
    return (Object.keys(LEGAL_DOCS) as LegalSlug[]).map((slug) => {
      const v = rows.find((r) => r.slug === slug);
      return { slug, title: v?.title ?? LEGAL_DOCS[slug], version: v ? this.label(v) : null, publishedAt: v?.publishedAt ?? null };
    });
  }

  async history(slug: LegalSlug) {
    const rows = await this.prisma.legalVersion.findMany({ where: { slug }, orderBy: { version: 'desc' }, take: 50 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.publishedBy))] } }, select: { id: true, email: true } });
    return rows.map((r) => ({ version: r.version, label: this.label(r), title: r.title, html: r.html, note: r.note, publishedAt: r.publishedAt, by: users.find((u) => u.id === r.publishedBy)?.email ?? '—' }));
  }

  async publish(slug: LegalSlug, input: LegalPublish, admin: User) {
    const html = cleanLegal(input.html);
    if (sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim().length < 200) throw new BadRequestException({ message: 'Текст документа слишком короткий', errors: { html: 'Не меньше 200 символов' } });
    const cur = await this.current(slug);
    if (cur && cur.html === html && cur.title === input.title) throw new BadRequestException({ message: 'Текст не изменился' });
    // Номер версии уникален по документу: при одновременной публикации вторая получит ошибку, а не перезапишет первую
    const v = await this.prisma.legalVersion.create({ data: { slug, version: (cur?.version ?? 0) + 1, title: input.title, html, note: input.note, publishedBy: admin.id } });
    await this.audit.log(admin.id, 'legal.publish', 'legal', slug, { version: v.version, note: input.note });
    return this.history(slug);
  }
}
