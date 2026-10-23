import { Injectable } from '@nestjs/common';
import { DEFAULT_STOREFRONT, type PlatformSettings, type StorefrontSettings } from '@aesculap/shared';
import { config } from '../config';
import { PrismaService } from './prisma.service';

const KEY = 'platform';

/**
 * Настройки платформы из админки (ТЗ §8): комиссия по умолчанию и таймауты. Значения из окружения —
 * только стартовые; кэш на 30 секунд, чтобы фоновые задачи не ходили в базу на каждом шаге.
 */
@Injectable()
export class SettingsService {
  private cache: { value: PlatformSettings; until: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  defaults(): PlatformSettings {
    return { defaultCommissionPct: 10, confirmHours: config.orders.confirmHours, payMinutes: config.orders.payMinutes };
  }

  async get(): Promise<PlatformSettings> {
    if (this.cache && this.cache.until > Date.now()) return this.cache.value;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    const value = { ...this.defaults(), ...((row?.value as Partial<PlatformSettings> | undefined) ?? {}) };
    this.cache = { value, until: Date.now() + 30_000 };
    return value;
  }

  /** Сбросить кэш (после изменения в обход set — например, в тестах) */
  invalidate() {
    this.cache = null;
  }

  async set(value: PlatformSettings, actorId: string) {
    await this.prisma.platformSetting.upsert({ where: { key: KEY }, update: { value, updatedBy: actorId }, create: { key: KEY, value, updatedBy: actorId } });
    this.cache = null;
    return this.get();
  }

  /** Настройки витрины (ТЗ §8) — отдельный ключ, без кэша процесса: главная и так кэшируется в Redis */
  async storefront(): Promise<StorefrontSettings> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: 'storefront' } });
    const v = (row?.value as Partial<StorefrontSettings> | undefined) ?? {};
    return { ...DEFAULT_STOREFRONT, ...v, hero: { ...DEFAULT_STOREFRONT.hero, ...v.hero }, premium: { ...DEFAULT_STOREFRONT.premium, ...v.premium }, capsuleOfWeek: { ...DEFAULT_STOREFRONT.capsuleOfWeek, ...v.capsuleOfWeek } };
  }

  async setStorefront(value: StorefrontSettings, actorId: string) {
    await this.prisma.platformSetting.upsert({ where: { key: 'storefront' }, update: { value, updatedBy: actorId }, create: { key: 'storefront', value, updatedBy: actorId } });
    return this.storefront();
  }
}
