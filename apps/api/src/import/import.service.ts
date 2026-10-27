import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MIN_PHOTOS, toKopecks } from '@aesculap/shared';
import { Prisma, type Gender, type ImportJob, type Supplier, type User } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { AuditService } from '../common/audit.service';
import { JobsService } from '../common/jobs.service';
import { MailService } from '../common/mail.service';
import { RateLimitService } from '../common/rate-limit.service';
import { repriceSales } from '../promotions/price';
import { PrismaService } from '../common/prisma.service';
import { shortId, slugify } from '../common/slug';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { MediaService } from '../products/media.service';
import { RestockService } from '../favorites/restock.service';
import { pickText, type RevisionData } from '../products/products.service';
import { fetchRemote, RemoteFetchError } from '../products/remote-fetch';
import { ParseError, parseCsv, parseXlsx, parseYml, type RawRow } from './parse';

const MAX_ROWS = 10_000;
const MAX_ERRORS = 200;
/** Проверка, каким фидам пора синхронизироваться, — раз в 10 минут; частота фида — 1, 6 или 24 ч (не чаще раза в час) */
const FEED_TICK_MS = 10 * 60_000;
const HOUR_MS = 3600_000;
export const FEED_EVERY_HOURS = [1, 6, 24] as const;
/** Ошибок подряд до автоматической паузы фида */
export const FEED_MAX_FAILURES = 3;

type RowError = { row: number; field: string; message: string };

type VariantRow = {
  sku: string; size: string; heightRange: string | null; colorId: string; price: number; oldPrice: number | null;
  stock: number; weightG: number; lengthMm: number; widthMm: number; heightMm: number;
};
type ProductGroup = {
  externalId: string; title: string; brand: string; categoryId: string; gender: Gender; fabric: string; treatment: string;
  washing: string; description: string; specialtyIds: string[]; photos: string[]; variants: VariantRow[]; existing: boolean;
};

const GENDER: Record<string, Gender> = { женский: 'female', женская: 'female', female: 'female', ж: 'female', мужской: 'male', мужская: 'male', male: 'male', м: 'male', унисекс: 'unisex', unisex: 'unisex', '': 'unisex' };
const lower = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
const num = (s: string | undefined) => Number((s ?? '').replace(/\s/g, '').replace(',', '.'));

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger('Import');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly restock: RestockService,
    private readonly limits: RateLimitService,
  ) {}

  async onModuleInit() {
    this.jobs.register('import:check', (d: { jobId: string }) => this.check(d.jobId));
    this.jobs.register('import:apply', (d: { jobId: string }) => this.apply(d.jobId));
    this.jobs.register('import:photo', (d: { jobId: string; productId: string; url: string }) => this.fetchPhoto(d));
    // Имя задачи прежнее: планировщик в Redis обновится с «раз в 6 ч» на «раз в 10 мин»
    this.jobs.register('yml:sync-all', () => this.syncDueFeeds().then(() => undefined));
    await this.jobs.repeat('yml:sync-all', FEED_TICK_MS);
  }

  // ─── запуск ──────────────────────────────────────────────────────────

  async uploadFile(supplier: Supplier, file: { originalname: string; buffer: Buffer }, actor: User) {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (ext !== 'xlsx' && ext !== 'csv') throw new BadRequestException({ message: 'Нужен файл XLSX или CSV по шаблону' });
    const job = await this.prisma.importJob.create({ data: { supplierId: supplier.id, source: 'file', fileName: file.originalname.slice(0, 200) } });
    const fileKey = `private/imports/${supplier.id}/${job.id}.${ext}`;
    await this.storage.put(fileKey, file.buffer);
    await this.prisma.importJob.update({ where: { id: job.id }, data: { fileKey } });
    await this.audit.log(actor.id, 'import.upload', 'import_job', job.id, { fileName: job.fileName });
    await this.jobs.enqueue('import:check', { jobId: job.id }, { attempts: 1 });
    return this.view(await this.prisma.importJob.findUniqueOrThrow({ where: { id: job.id } }));
  }

  async setFeed(supplier: Supplier, url: string | null, actor: User) {
    await this.prisma.supplier.update({ where: { id: supplier.id }, data: { ymlFeedUrl: url } });
    // Новая ссылка — счётчик ошибок и пауза сбрасываются, частота остаётся
    await this.prisma.supplierFeedSchedule.upsert({
      where: { supplierId: supplier.id },
      create: { supplierId: supplier.id },
      update: { failures: 0, pausedAt: null, pauseReason: null },
    });
    await this.audit.log(actor.id, 'import.feed', 'supplier', supplier.id, { url });
    return url ? this.syncFeed(supplier.id) : null;
  }

  /** Синк фида: проверка и автоприменение (ручного шага нет — ТЗ §7.4). */
  async syncFeed(supplierId: string, now = new Date()) {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
    if (!supplier.ymlFeedUrl) throw new BadRequestException({ message: 'Ссылка на фид не указана' });
    const running = await this.prisma.importJob.findFirst({ where: { supplierId, source: 'yml', status: { in: ['queued', 'checking', 'applying'] } } });
    if (running) return this.view(running);
    await this.prisma.supplierFeedSchedule.upsert({ where: { supplierId }, create: { supplierId, lastRunAt: now }, update: { lastRunAt: now } });
    const job = await this.prisma.importJob.create({ data: { supplierId, source: 'yml', feedUrl: supplier.ymlFeedUrl, fileName: 'YML-фид', autoApply: true } });
    await this.jobs.enqueue('import:check', { jobId: job.id }, { attempts: 1 });
    return this.view(await this.prisma.importJob.findUniqueOrThrow({ where: { id: job.id } }));
  }

  /** «Синхронизировать» из кабинета: не чаще 10 раз в час, работает и на паузе */
  async syncFeedManual(supplierId: string) {
    await this.limits.hit('feed-sync', supplierId, 10, 3600);
    return this.syncFeed(supplierId);
  }

  /**
   * Задача по расписанию: фиды активных поставщиков без паузы, у которых с прошлого запуска прошло
   * everyHours (с запасом 5 минут на шаг планировщика). Возвращает id поставщиков, чей синк запущен.
   */
  async syncDueFeeds(now = new Date()) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { status: 'active', ymlFeedUrl: { not: null }, OR: [{ feedSchedule: null }, { feedSchedule: { pausedAt: null } }] },
      select: { id: true, feedSchedule: true },
    });
    const started: string[] = [];
    for (const s of suppliers) {
      const every = Math.max(1, s.feedSchedule?.everyHours ?? 6) * HOUR_MS;
      const last = s.feedSchedule?.lastRunAt?.getTime();
      if (last && now.getTime() - last < every - 5 * 60_000) continue;
      try {
        await this.syncFeed(s.id, now);
        started.push(s.id);
      } catch (e) {
        this.logger.error(`Фид ${s.id}: ${(e as Error).message}`);
      }
    }
    return started;
  }

  async feedState(supplierId: string) {
    const [supplier, sch, last] = await Promise.all([
      this.prisma.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { ymlFeedUrl: true } }),
      this.prisma.supplierFeedSchedule.findUnique({ where: { supplierId } }),
      this.prisma.importJob.findFirst({ where: { supplierId, source: 'yml' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const everyHours = sch?.everyHours ?? 6;
    const paused = Boolean(sch?.pausedAt);
    return {
      url: supplier.ymlFeedUrl,
      everyHours,
      paused,
      pauseReason: (sch?.pauseReason as 'manual' | 'errors' | null) ?? null,
      pausedAt: sch?.pausedAt ?? null,
      failures: sch?.failures ?? 0,
      lastRunAt: sch?.lastRunAt ?? null,
      nextRunAt: supplier.ymlFeedUrl && !paused ? new Date(Math.max(Date.now(), (sch?.lastRunAt?.getTime() ?? Date.now()) + everyHours * HOUR_MS)) : null,
      lastJob: last ? this.view(last) : null,
    };
  }

  /** Частота и пауза фида. Включение после паузы сбрасывает счётчик ошибок. */
  async setFeedSchedule(supplier: Supplier, input: { everyHours: number; paused: boolean }, actor: User) {
    if (!(FEED_EVERY_HOURS as readonly number[]).includes(input.everyHours)) throw new BadRequestException({ message: 'Частота — каждый 1, 6 или 24 часа' });
    const cur = await this.prisma.supplierFeedSchedule.findUnique({ where: { supplierId: supplier.id } });
    const pause = input.paused ? { pausedAt: cur?.pausedAt ?? new Date(), pauseReason: cur?.pausedAt ? cur.pauseReason : 'manual' } : { pausedAt: null, pauseReason: null, failures: 0 };
    await this.prisma.supplierFeedSchedule.upsert({
      where: { supplierId: supplier.id },
      create: { supplierId: supplier.id, everyHours: input.everyHours, ...pause },
      update: { everyHours: input.everyHours, ...pause },
    });
    await this.audit.log(actor.id, 'import.feed_schedule', 'supplier', supplier.id, { everyHours: input.everyHours, paused: input.paused });
    return this.feedState(supplier.id);
  }

  /** Ошибка синка: уведомление в колокольчик; после FEED_MAX_FAILURES подряд — автоматическая пауза */
  private async feedFailed(supplierId: string, reason: string) {
    const sch = await this.prisma.supplierFeedSchedule.upsert({
      where: { supplierId },
      create: { supplierId, failures: 1 },
      update: { failures: { increment: 1 } },
    });
    if (sch.failures >= FEED_MAX_FAILURES && !sch.pausedAt) {
      await this.prisma.supplierFeedSchedule.update({ where: { supplierId }, data: { pausedAt: new Date(), pauseReason: 'errors' } });
      await this.notifyOwners(
        supplierId,
        'Синхронизация фида приостановлена',
        `${sch.failures} ошибки подряд, последняя: ${reason}. Проверьте ссылку и включите синк в разделе «Импорт».`,
      );
      return;
    }
    await this.notifyOwners(supplierId, 'Синхронизация фида не удалась', `Причина: ${reason}`);
  }

  async requestApply(supplier: Supplier, jobId: string, actor: User) {
    const job = await this.getJob(supplier.id, jobId);
    if (job.status !== 'checked') throw new BadRequestException({ message: 'Импорт ещё не проверен или уже применён' });
    if (job.totalRows - job.errorRows === 0) throw new BadRequestException({ message: 'Нет строк без ошибок' });
    await this.audit.log(actor.id, 'import.apply', 'import_job', jobId);
    await this.jobs.enqueue('import:apply', { jobId }, { attempts: 1 });
    return this.view(await this.getJob(supplier.id, jobId));
  }

  // ─── проверка (dry-run) ──────────────────────────────────────────────

  async check(jobId: string) {
    const job = await this.prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'checking' } });
    try {
      const rows = await this.readRows(job);
      if (rows.length > MAX_ROWS) throw new ParseError(`В файле ${rows.length} строк — больше ${MAX_ROWS}. Разбейте на части.`);
      const { groups, errors } = await this.validate(job.supplierId, rows);
      const validRows = groups.reduce((s, g) => s + g.variants.length, 0);
      const newRows = groups.filter((g) => !g.existing).reduce((s, g) => s + g.variants.length, 0);
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'checked',
          checkedAt: new Date(),
          totalRows: rows.length,
          errorRows: rows.length - validRows,
          newProducts: newRows,
          updates: validRows - newRows,
          errors: errors.slice(0, MAX_ERRORS) as unknown as Prisma.InputJsonValue,
          payload: groups as unknown as Prisma.InputJsonValue,
        },
      });
      if (job.autoApply && validRows === 0) throw new ParseError(rows.length ? 'в фиде нет ни одной строки без ошибок' : 'в фиде нет товаров');
      if (job.autoApply) await this.jobs.enqueue('import:apply', { jobId }, { attempts: 1 });
    } catch (e) {
      const message = e instanceof ParseError || e instanceof RemoteFetchError ? e.message : 'Внутренняя ошибка при чтении файла';
      if (!(e instanceof ParseError || e instanceof RemoteFetchError)) this.logger.error(`check ${jobId}: ${(e as Error).stack}`);
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'failed', failReason: message } });
      if (job.source === 'yml') await this.feedFailed(job.supplierId, message);
    }
  }

  private async readRows(job: ImportJob): Promise<RawRow[]> {
    if (job.source === 'yml') {
      const { data } = await fetchRemote(job.feedUrl!, 50 * 1048576, /xml|text\/plain|octet-stream/, 60_000).catch((e: Error) => {
        throw new RemoteFetchError(`не удалось скачать фид: ${e.message}`);
      });
      return parseYml(data.toString('utf8'));
    }
    const buffer = await readFile(this.storage.localPath(job.fileKey!));
    return job.fileKey!.endsWith('.csv') ? parseCsv(buffer) : parseXlsx(buffer);
  }

  private async validate(supplierId: string, rows: RawRow[]) {
    const [categories, colors, specialties, existing] = await Promise.all([
      this.prisma.category.findMany(),
      this.prisma.color.findMany(),
      this.prisma.specialty.findMany(),
      this.prisma.product.findMany({ where: { supplierId, externalId: { not: null } }, select: { externalId: true } }),
    ]);
    const catByName = new Map(categories.flatMap((c) => [[lower(c.name), c.id], [lower(c.slug), c.id]]));
    const colorByName = new Map(colors.map((c) => [lower(c.name), c.id]));
    const specByName = new Map(specialties.map((s) => [lower(s.name), s.id]));
    const existingIds = new Set(existing.map((p) => p.externalId));

    const errors: RowError[] = [];
    const groups = new Map<string, ProductGroup>();
    const seenSku = new Set<string>();

    for (const r of rows) {
      const rowErrors: RowError[] = [];
      const err = (field: string, message: string) => rowErrors.push({ row: r.__row, field, message });
      const required = ['external_id', 'title', 'brand', 'category', 'sku', 'size', 'color'] as const;
      for (const f of required) if (!r[f]?.trim()) err(f, 'пусто');

      const categoryId = catByName.get(lower(r.category));
      if (r.category && !categoryId) err('category', `«${r.category}» нет в справочнике категорий`);
      const colorId = colorByName.get(lower(r.color));
      if (r.color && !colorId) err('color', `цвета «${r.color}» нет в справочнике`);
      const gender = GENDER[lower(r.gender)];
      if (!gender) err('gender', `«${r.gender}» — укажите Женский, Мужской или Унисекс`);
      const specNames = (r.specialties ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const specIds = specNames.map((n) => specByName.get(lower(n)));
      specNames.forEach((n, i) => !specIds[i] && err('specialties', `специальности «${n}» нет в справочнике`));

      const price = num(r.price);
      if (!(price > 0)) err('price', 'цена должна быть больше 0');
      const oldPrice = r.old_price ? num(r.old_price) : null;
      if (oldPrice !== null && !(oldPrice > price)) err('old_price', 'старая цена должна быть выше текущей');
      const stock = num(r.stock);
      if (r.stock === '' || r.stock === undefined) err('stock', 'нет остатка');
      else if (!Number.isInteger(stock) || stock < 0) err('stock', 'остаток — целое число ≥ 0');
      const dims = (['weight_g', 'length_mm', 'width_mm', 'height_mm'] as const).map((f) => {
        const v = num(r[f]);
        if (!(v > 0)) err(f, 'нужно для СДЭК');
        return Math.round(v);
      });
      const skuKey = lower(r.sku);
      if (skuKey && seenSku.has(skuKey)) err('sku', `SKU ${r.sku} повторяется в файле`);
      seenSku.add(skuKey);
      const photos = (r.photos ?? '').split(/[|\s]+/).filter(Boolean);
      if (photos.some((u) => !/^https?:\/\//i.test(u))) err('photos', 'ссылки на фото должны начинаться с http(s)://');

      if (rowErrors.length) {
        errors.push(...rowErrors);
        continue;
      }
      const key = r.external_id!.trim();
      let g = groups.get(key);
      if (!g) {
        g = {
          externalId: key, title: r.title!.trim(), brand: r.brand!.trim(), categoryId: categoryId!, gender, fabric: r.fabric ?? '',
          treatment: r.treatment ?? '', washing: r.washing ?? '', description: r.description ?? '',
          specialtyIds: specIds as string[], photos, variants: [], existing: existingIds.has(key),
        };
        groups.set(key, g);
      }
      for (const u of photos) if (!g.photos.includes(u)) g.photos.push(u);
      g.variants.push({
        sku: r.sku!.trim(), size: r.size!.trim(), heightRange: r.height_range?.trim() || null, colorId: colorId!,
        price, oldPrice, stock, weightG: dims[0], lengthMm: dims[1], widthMm: dims[2], heightMm: dims[3],
      });
    }
    return { groups: [...groups.values()], errors };
  }

  // ─── применение ──────────────────────────────────────────────────────

  async apply(jobId: string) {
    const job = await this.prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== 'checked') return;
    await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'applying' } });
    const groups = (job.payload ?? []) as unknown as ProductGroup[];
    const source = job.source === 'yml' ? 'yml' : 'file';
    try {
      const brandIds = new Map<string, string>();
      for (const g of groups) {
        const brandId = brandIds.get(lower(g.brand)) ?? (await this.ensureBrand(g.brand));
        brandIds.set(lower(g.brand), brandId);
        await this.applyGroup(job, g, brandId, source);
      }
      if (job.source === 'yml') {
        // Позиции, пропавшие из полного фида, — нет в наличии.
        const skus = groups.flatMap((g) => g.variants.map((v) => v.sku));
        await this.prisma.productVariant.updateMany({ where: { product: { supplierId: job.supplierId, source: 'yml' }, sku: { notIn: skus } }, data: { stock: 0 } });
      }
      // Синк обновляет цену поставщика; акционная цена пересчитывается от неё, а не перетирается (ТЗ §7.7).
      await repriceSales(this.prisma);
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'applied', appliedAt: new Date(), payload: Prisma.DbNull } });
      if (job.source === 'yml') await this.prisma.supplierFeedSchedule.updateMany({ where: { supplierId: job.supplierId }, data: { failures: 0 } });
      // Импорт или синк фида пополнил остатки — письма подписчикам «Сообщить о поступлении»
      await this.restock.check({ supplierId: job.supplierId }).catch((e: Error) => this.logger.warn(`restock ${jobId}: ${e.message}`));
      // Фид синкается до раза в час — об успешном синке без ошибок в строках не уведомляем
      if (job.source !== 'yml' || job.errorRows > 0) {
        await this.notifyOwners(
          job.supplierId,
          job.source === 'yml' ? 'Фид синхронизирован, есть строки с ошибками' : 'Импорт применён',
          `Строк: ${job.totalRows}; новые товары: ${job.newProducts} строк; обновления: ${job.updates}; с ошибками: ${job.errorRows}.`,
        );
      }
    } catch (e) {
      this.logger.error(`apply ${jobId}: ${(e as Error).stack}`);
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'failed', failReason: 'Ошибка при записи товаров. Повторите импорт.' } });
      if (job.source === 'yml') await this.feedFailed(job.supplierId, 'ошибка при записи товаров');
    }
  }

  private async ensureBrand(name: string) {
    const found = await this.prisma.brand.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    return found?.id ?? (await this.prisma.brand.create({ data: { name, slug: `${slugify(name) || 'brand'}-${shortId()}` } })).id;
  }

  private async applyGroup(job: ImportJob, g: ProductGroup, brandId: string, source: 'file' | 'yml') {
    const text = { title: g.title, brandId, categoryId: g.categoryId, gender: g.gender, fabric: g.fabric || null, treatment: g.treatment || null, washing: g.washing || null, description: g.description || null };
    let product = await this.prisma.product.findUnique({ where: { supplierId_externalId: { supplierId: job.supplierId, externalId: g.externalId } }, include: { specialties: true, media: true } });

    if (!product) {
      // Новый товар: на модерацию, если есть минимум фото; иначе черновик (ТЗ §7.4).
      const created = await this.prisma.product.create({
        data: {
          supplierId: job.supplierId,
          externalId: g.externalId,
          slug: `${slugify(g.title) || 'tovar'}-${shortId()}`,
          ...text,
          source,
          moderationStatus: g.photos.length >= MIN_PHOTOS ? 'pending' : 'draft',
          submittedAt: g.photos.length >= MIN_PHOTOS ? new Date() : null,
          specialties: { create: g.specialtyIds.map((specialtyId) => ({ specialtyId })) },
        },
      });
      product = { ...created, specialties: [], media: [] };
    } else if (!product.manualOverride) {
      const live = ['published', 'hidden'].includes(product.moderationStatus);
      if (!live) {
        await this.prisma.product.update({ where: { id: product.id }, data: text });
        await this.prisma.productSpecialty.deleteMany({ where: { productId: product.id } });
        await this.prisma.productSpecialty.createMany({ data: g.specialtyIds.map((specialtyId) => ({ productId: product!.id, specialtyId })) });
      } else {
        const current = pickText(product);
        const next = pickText(text as typeof product);
        const textChanged = (Object.keys(current) as (keyof typeof current)[]).some((k) => (current[k] ?? '') !== (next[k] ?? ''));
        const specChanged = product.specialties.map((s) => s.specialtyId).sort().join() !== [...g.specialtyIds].sort().join();
        if (textChanged || specChanged) {
          const approved = product.media.filter((m) => m.approved).sort((a, b) => a.position - b.position);
          const data: RevisionData = { ...next, specialtyIds: g.specialtyIds, media: { order: approved.map((m) => m.id), mainId: approved.find((m) => m.isMain)?.id ?? null, removed: [] } };
          await this.prisma.productRevision.deleteMany({ where: { productId: product.id, status: { in: ['pending', 'rejected'] } } });
          await this.prisma.productRevision.create({ data: { productId: product.id, data: data as unknown as Prisma.InputJsonValue } });
        }
      }
    }

    // Цены, остатки и варианты — всегда сразу.
    for (const v of g.variants) {
      const data = { ...v, price: toKopecks(v.price), oldPrice: v.oldPrice ? toKopecks(v.oldPrice) : null };
      await this.prisma.productVariant.upsert({ where: { productId_sku: { productId: product.id, sku: v.sku } }, update: data, create: { ...data, productId: product.id } });
    }

    // Фото: для товаров не на витрине и без ручных правок; качаются в фоне.
    const canTouchMedia = !product.manualOverride && !['published', 'hidden'].includes(product.moderationStatus);
    if (canTouchMedia) {
      const have = new Set(product.media.map((m) => m.sourceUrl));
      for (const url of g.photos.slice(0, 8)) {
        if (!have.has(url)) await this.jobs.enqueue('import:photo', { jobId: job.id, productId: product.id, url }, { attempts: 2 });
      }
    }
  }

  private async fetchPhoto(d: { jobId: string; productId: string; url: string }) {
    try {
      await this.media.addPhotoFromUrl(d.productId, d.url);
    } catch (e) {
      const message = e instanceof RemoteFetchError || e instanceof BadRequestException ? (e instanceof BadRequestException ? String((e.getResponse() as { message?: string }).message) : e.message) : 'не удалось обработать';
      const entry = JSON.stringify([{ row: 0, field: 'photos', message: `${d.url} — ${message}` }]);
      await this.prisma.$executeRaw`UPDATE import_jobs SET errors = errors || ${entry}::jsonb WHERE id = ${d.jobId}::uuid AND jsonb_array_length(errors) < ${MAX_ERRORS}`;
    }
  }

  // ─── чтение ──────────────────────────────────────────────────────────

  async list(supplierId: string) {
    const jobs = await this.prisma.importJob.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, take: 30 });
    return jobs.map((j) => this.view(j));
  }

  private async getJob(supplierId: string, id: string) {
    const job = await this.prisma.importJob.findFirst({ where: { id, supplierId } });
    if (!job) throw new NotFoundException();
    return job;
  }

  async get(supplierId: string, id: string) {
    return this.view(await this.getJob(supplierId, id), true);
  }

  async errorsCsv(supplierId: string, id: string) {
    const job = await this.getJob(supplierId, id);
    const errors = job.errors as unknown as RowError[];
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    return '﻿' + ['Строка;Поле;Ошибка', ...errors.map((e) => [e.row || '', e.field, e.message].map(esc).join(';'))].join('\r\n');
  }

  view(j: ImportJob, withErrors = false) {
    return {
      id: j.id,
      source: j.source,
      fileName: j.fileName,
      status: j.status,
      totalRows: j.totalRows,
      newProducts: j.newProducts,
      updates: j.updates,
      errorRows: j.errorRows,
      failReason: j.failReason,
      createdAt: j.createdAt,
      checkedAt: j.checkedAt,
      appliedAt: j.appliedAt,
      errors: withErrors ? (j.errors as unknown as RowError[]) : (j.errors as unknown as RowError[]).slice(0, 3),
    };
  }

  private notifyOwners(supplierId: string, subject: string, text: string) {
    return this.notifications.notify(supplierId, 'import_report', { title: subject, body: text, link: '/supplier/import' });
  }
}
