import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PartnerApiKey, Supplier, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';

/** Не больше активных ключей у поставщика */
export const MAX_ACTIVE_KEYS = 5;
const KEY_RE = /^ak_[A-Za-z0-9_-]{32}$/;

const view = (k: PartnerApiKey) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt });

/**
 * Ключи партнёрского API (docs/PARTNER_API.md). Ключ `ak_<32 символа base64url>` показывается один раз при создании,
 * в базе — только SHA-256 (у ключа 192 бита случайности, соль не нужна) и начало для списка.
 */
@Injectable()
export class PartnerKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(supplierId: string) {
    const rows = await this.prisma.partnerApiKey.findMany({ where: { supplierId }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], take: 50 });
    return rows.map(view);
  }

  async create(supplier: Supplier, name: string, actor: User) {
    const active = await this.prisma.partnerApiKey.count({ where: { supplierId: supplier.id, revokedAt: null } });
    if (active >= MAX_ACTIVE_KEYS) throw new BadRequestException({ message: `Не больше ${MAX_ACTIVE_KEYS} действующих ключей — отзовите ненужный` });
    const key = `ak_${randomBytes(24).toString('base64url')}`;
    const row = await this.prisma.partnerApiKey.create({
      data: { supplierId: supplier.id, name, prefix: key.slice(0, 7), hash: sha256(key), createdById: actor.id },
    });
    await this.audit.log(actor.id, 'partner_key.create', 'partner_api_key', row.id, { supplierId: supplier.id, name, prefix: row.prefix });
    return { key, item: view(row) };
  }

  async revoke(supplier: Supplier, id: string, actor: User) {
    const r = await this.prisma.partnerApiKey.updateMany({ where: { id, supplierId: supplier.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException({ message: 'Ключ не найден или уже отозван' });
    await this.audit.log(actor.id, 'partner_key.revoke', 'partner_api_key', id, { supplierId: supplier.id });
    return this.list(supplier.id);
  }

  /** Действующий ключ и его поставщик по значению из заголовка Authorization */
  async resolve(raw: string) {
    if (!KEY_RE.test(raw)) return null;
    const key = await this.prisma.partnerApiKey.findUnique({ where: { hash: sha256(raw) }, include: { supplier: true } });
    if (!key || key.revokedAt) return null;
    // «Последнее использование» — не чаще раза в минуту, чтобы не писать в базу на каждый запрос
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await this.prisma.partnerApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
    return key;
  }
}
