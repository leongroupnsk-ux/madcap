import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';

const CACHE_KEY = 'admin:dashboard:v1';
const CACHE_TTL = 300;
/** SLA модерации — 24 часа от отправки до решения (ТЗ §8) */
export const MODERATION_SLA_HOURS = 24;
/** Сутки считаются по Москве: «сегодня» владельца — московский день */
const TZ = 'Europe/Moscow';

type DayRow = { day: string; gmv: number; commission: number; orders: number; total: number; capsule: number };
type Period = { gmv: number; commission: number; orders: number; avgCheck: number };
type ModerationRow = { kind: string; n: number; p50: number | null; p90: number | null; over: number };

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : v == null ? 0 : Number(v));

/**
 * Дашборд платформы (ТЗ §8): деньги, воронка подбора, сроки модерации и очереди «требуют внимания».
 * Всё считается агрегатами в SQL (без выборки строк в память); результат кэшируется в Redis на 5 минут —
 * дашборд открывают часто, а цифры за 30 дней за 5 минут почти не меняются.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get(fresh = false) {
    if (!fresh) {
      const cached = await this.redis.client.get(CACHE_KEY).catch(() => null);
      if (cached) return JSON.parse(cached) as Awaited<ReturnType<DashboardService['compute']>>;
    }
    const value = await this.compute();
    await this.redis.client.set(CACHE_KEY, JSON.stringify(value), 'EX', CACHE_TTL).catch(() => undefined);
    return value;
  }

  async compute(now = new Date()) {
    const [days, funnel, moderation, overdue, queues] = await Promise.all([this.days(), this.funnel(), this.moderation(), this.moderationOverdue(now), this.queues(now)]);
    const sum = (rows: DayRow[]): Period => {
      const gmv = rows.reduce((s, r) => s + r.gmv, 0);
      const orders = rows.reduce((s, r) => s + r.orders, 0);
      const total = rows.reduce((s, r) => s + r.total, 0);
      return { gmv, commission: rows.reduce((s, r) => s + r.commission, 0), orders, avgCheck: orders ? Math.round(total / orders) : 0 };
    };
    const last30 = sum(days);
    const capsuleOrders = days.reduce((s, r) => s + r.capsule, 0);
    const byKind = Object.fromEntries(moderation.map((m) => [m.kind, m]));
    const kinds = [
      ['product', 'Товары: новые и правки'],
      ['content', 'Статьи и подборки'],
      ['review', 'Отзывы'],
      ['all', 'Всего'],
    ] as const;
    return {
      computedAt: now.toISOString(),
      cacheSeconds: CACHE_TTL,
      periods: { today: sum(days.slice(-1)), week: sum(days.slice(-7)), month: last30 },
      days: days.map(({ day, gmv, commission, orders }) => ({ day, gmv, commission, orders })),
      funnel: {
        quizStarted: funnel.started,
        quizCompleted: funnel.completed,
        capsulesBuilt: funnel.capsules,
        // Событие «капсула в корзину» не пишется: корзина гостя живёт в браузере, на сервер приходит только итоговый состав
        capsuleToCart: null,
        orders: last30.orders,
        capsuleOrders,
        capsuleShare: last30.orders ? Math.round((capsuleOrders / last30.orders) * 1000) / 10 : 0,
      },
      moderation: {
        slaHours: MODERATION_SLA_HOURS,
        rows: kinds.map(([kind, label]) => {
          const m = byKind[kind];
          const toH = (s: number | null | undefined) => (s == null ? null : Math.round((s / 3600) * 10) / 10);
          return {
            kind, label, decided: m?.n ?? 0, medianHours: toH(m?.p50), p90Hours: toH(m?.p90), overSla: m?.over ?? 0,
            pendingOverSla: kind === 'all' ? Object.values(overdue).reduce((s, v) => s + v, 0) : overdue[kind as keyof typeof overdue],
          };
        }),
      },
      queues,
    };
  }

  /** 30 московских дней: сумма товаров и комиссия по оплаченным заказам (без отменённых отправлений), число заказов, доля с капсулой */
  private async days(): Promise<DayRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      WITH bounds AS (SELECT (now() AT TIME ZONE ${TZ})::date AS today),
      paid AS (
        SELECT o.id, o.total, ((o."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date AS day,
          COALESCE(SUM(s."goodsTotal") FILTER (WHERE s.status NOT IN ('cancelled', 'rejected')), 0) AS gmv,
          COALESCE(SUM(s.commission) FILTER (WHERE s.status NOT IN ('cancelled', 'rejected')), 0) AS commission,
          bool_or(EXISTS (SELECT 1 FROM shipment_items i WHERE i."shipmentId" = s.id AND i."fromCapsule")) AS capsule
        FROM orders o
        JOIN shipments s ON s."orderId" = o.id
        WHERE o.status = 'paid'
          AND o."paidAt" >= (((SELECT today FROM bounds) - 29)::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC'
        GROUP BY o.id
      )
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(p.gmv), 0)::bigint AS gmv,
        COALESCE(SUM(p.commission), 0)::bigint AS commission,
        COUNT(p.id)::int AS orders,
        COALESCE(SUM(p.total), 0)::bigint AS total,
        COUNT(p.id) FILTER (WHERE p.capsule)::int AS capsule
      FROM bounds, generate_series(bounds.today - 29, bounds.today, interval '1 day') AS d
      LEFT JOIN paid p ON p.day = d::date
      GROUP BY d ORDER BY d`);
    return rows.map((r) => ({ day: String(r.day), gmv: num(r.gmv), commission: num(r.commission), orders: num(r.orders), total: num(r.total), capsule: num(r.capsule) }));
  }

  /** Воронка подбора за 30 дней: начали анкету → прошли → капсула собрана */
  private async funnel() {
    const [r] = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM buyer_profiles WHERE "quizStartedAt" >= now() - interval '30 days')::int AS started,
        (SELECT COUNT(*) FROM buyer_profiles WHERE "quizCompletedAt" >= now() - interval '30 days')::int AS completed,
        (SELECT COUNT(DISTINCT "userId") FROM capsules WHERE "builtAt" >= now() - interval '30 days')::int AS capsules`);
    return { started: num(r.started), completed: num(r.completed), capsules: num(r.capsules) };
  }

  /**
   * Сроки модерации за 30 дней: от отправки на модерацию до решения. Решение — запись журнала аудита moderation.*;
   * отправка — последняя отправка до решения (журнал product.submit / content.*.submit / review.create|update,
   * либо поле submittedAt, если оно не позже решения). Правки опубликованных товаров — по полям ревизии.
   */
  private async moderation(): Promise<ModerationRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      WITH d AS (
        SELECT a.action, a.entity, a."entityId", a.at FROM audit_log a
        WHERE a.at >= now() - interval '30 days'
          AND a.action IN ('moderation.product.approve', 'moderation.product.reject', 'moderation.article.approve', 'moderation.article.reject',
                           'moderation.collection.approve', 'moderation.collection.reject', 'moderation.review.approve', 'moderation.review.reject')
      ),
      t AS (
        SELECT 'product' AS kind, EXTRACT(EPOCH FROM d.at - GREATEST(
            (SELECT MAX(s.at) FROM audit_log s WHERE s.action = 'product.submit' AND s."entityId" = d."entityId" AND s.at <= d.at),
            (SELECT p."submittedAt" FROM products p WHERE p.id::text = d."entityId" AND p."submittedAt" <= d.at))) AS secs
        FROM d WHERE d.action LIKE 'moderation.product.%'
        UNION ALL
        SELECT 'product', EXTRACT(EPOCH FROM r."reviewedAt" - r."createdAt") FROM product_revisions r WHERE r."reviewedAt" >= now() - interval '30 days'
        UNION ALL
        SELECT 'content', EXTRACT(EPOCH FROM d.at - GREATEST(
            (SELECT MAX(s.at) FROM audit_log s WHERE s.action IN ('content.article.submit', 'content.collection.submit') AND s."entityId" = d."entityId" AND s.at <= d.at),
            (SELECT x."submittedAt" FROM articles x WHERE d.entity = 'article' AND x.id::text = d."entityId" AND x."submittedAt" <= d.at),
            (SELECT x."submittedAt" FROM collections x WHERE d.entity = 'collection' AND x.id::text = d."entityId" AND x."submittedAt" <= d.at)))
        FROM d WHERE d.action LIKE 'moderation.article.%' OR d.action LIKE 'moderation.collection.%'
        UNION ALL
        SELECT 'review', EXTRACT(EPOCH FROM d.at - (SELECT MAX(s.at) FROM audit_log s WHERE s.action IN ('review.create', 'review.update') AND s."entityId" = d."entityId" AND s.at <= d.at))
        FROM d WHERE d.action LIKE 'moderation.review.%'
      )
      SELECT COALESCE(kind, 'all') AS kind, COUNT(*)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY secs) AS p90,
        COUNT(*) FILTER (WHERE secs > ${MODERATION_SLA_HOURS * 3600})::int AS over
      FROM t WHERE secs IS NOT NULL AND secs >= 0
      GROUP BY GROUPING SETS ((kind), ())`);
    return rows.map((r) => ({ kind: String(r.kind), n: num(r.n), p50: r.p50 == null ? null : num(r.p50), p90: r.p90 == null ? null : num(r.p90), over: num(r.over) }));
  }

  /** Сейчас в очереди дольше SLA */
  private async moderationOverdue(now: Date) {
    const cutoff = new Date(now.getTime() - MODERATION_SLA_HOURS * 3600000);
    const [r] = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT
        ((SELECT COUNT(*) FROM products WHERE "moderationStatus" = 'pending' AND COALESCE("submittedAt", "updatedAt") < ${cutoff})
         + (SELECT COUNT(*) FROM product_revisions WHERE status = 'pending' AND "createdAt" < ${cutoff}))::int AS product,
        ((SELECT COUNT(*) FROM articles WHERE status = 'pending' AND COALESCE("submittedAt", "updatedAt") < ${cutoff})
         + (SELECT COUNT(*) FROM collections WHERE status = 'pending' AND COALESCE("submittedAt", "updatedAt") < ${cutoff}))::int AS content,
        (SELECT COUNT(*) FROM reviews WHERE status = 'pending' AND "updatedAt" < ${cutoff})::int AS review`);
    return { product: num(r.product), content: num(r.content), review: num(r.review) };
  }

  /** Очереди «требуют внимания» — те же условия, что у фильтров разделов (заказы «с проблемами» — как фильтр в «Заказах») */
  private async queues(now: Date) {
    const day = new Date(now.getTime() - 24 * 3600000);
    const [r] = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(DISTINCT s."orderId") FROM shipments s
          WHERE (s.status = 'new' AND s."paidAt" < ${day})
             OR EXISTS (SELECT 1 FROM return_requests r WHERE r."shipmentId" = s.id AND r.status = 'requested'))::int AS "problemOrders",
        (SELECT COUNT(*) FROM shipments WHERE status = 'new' AND "paidAt" < ${day})::int AS unconfirmed,
        (SELECT COUNT(*) FROM supplier_applications WHERE status = 'new')::int AS applications,
        ((SELECT COUNT(*) FROM products WHERE "moderationStatus" = 'pending') + (SELECT COUNT(*) FROM product_revisions WHERE status = 'pending'))::int AS "moderationProducts",
        ((SELECT COUNT(*) FROM articles WHERE status = 'pending') + (SELECT COUNT(*) FROM collections WHERE status = 'pending'))::int AS "moderationContent",
        (SELECT COUNT(*) FROM reviews WHERE status = 'pending')::int AS "moderationReviews",
        (SELECT COUNT(*) FROM premium_leads WHERE status = 'new')::int AS premium,
        (SELECT COUNT(*) FROM return_requests WHERE status = 'requested')::int AS returns`);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, num(v)])) as Record<
      'problemOrders' | 'unconfirmed' | 'applications' | 'moderationProducts' | 'moderationContent' | 'moderationReviews' | 'premium' | 'returns',
      number
    >;
  }

  /** Сброс кэша (тесты) */
  async invalidate() {
    await this.redis.client.del(CACHE_KEY);
  }
}
