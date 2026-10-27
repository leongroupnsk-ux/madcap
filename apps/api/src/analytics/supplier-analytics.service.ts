import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const TZ = 'Europe/Moscow';
const DAY = 86_400_000;

/** Дата по Москве в виде YYYY-MM-DD */
const moscowDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

type DayRow = { day: string; revenue: bigint; units: number; orders: number };
type TopRow = { productId: string | null; slug: string | null; title: string; units: number; revenue: bigint; returned: number };
type CapsuleRow = { productId: string; slug: string; title: string; hits: number; zeroHits: number; stock: number };

/**
 * Аналитика продаж поставщика (кабинет «Аналитика»): выручка и штуки по дням, топ товаров, доля возвратов,
 * воронка «просмотры → корзина → заказ», попадания товаров в капсулы. Продажа — оплаченное отправление (paidAt в периоде),
 * кроме отменённых и отклонённых; выручка — по цене продажи, до вычета комиссии и возвратов.
 */
@Injectable()
export class SupplierAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(supplierId: string, days: 30 | 90, now = new Date()) {
    // Начало первого дня периода по Москве (сегодня — последний день)
    const today = moscowDay(now);
    const firstDay = moscowDay(new Date(now.getTime() - (days - 1) * DAY));
    const from = new Date(`${firstDay}T00:00:00+03:00`);

    const sold = `
      FROM shipments s JOIN shipment_items i ON i."shipmentId" = s.id
      WHERE s."supplierId" = $1::uuid AND s."paidAt" >= $2 AND s.status NOT IN ('awaiting_payment', 'cancelled', 'rejected')`;
    const [daily, totals, top, funnel, capsules, zeroInCapsules] = await Promise.all([
      this.prisma.$queryRawUnsafe<DayRow[]>(
        `SELECT to_char((s."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day,
                SUM(i.price * i.qty)::bigint AS revenue, SUM(i.qty)::int AS units, COUNT(DISTINCT s.id)::int AS orders
         ${sold} GROUP BY 1 ORDER BY 1`,
        supplierId, from,
      ),
      this.prisma.$queryRawUnsafe<{ revenue: bigint | null; units: number | null; orders: number; lines: number; returned: number | null; returnedSum: bigint | null }[]>(
        `SELECT SUM(i.price * i.qty)::bigint AS revenue, SUM(i.qty)::int AS units, COUNT(DISTINCT s.id)::int AS orders, COUNT(i.id)::int AS lines,
                SUM(i."returnedQty")::int AS returned, SUM(i.price * i."returnedQty")::bigint AS "returnedSum"
         ${sold}`,
        supplierId, from,
      ),
      this.prisma.$queryRawUnsafe<TopRow[]>(
        `SELECT MAX(p.id::text) AS "productId", MAX(COALESCE(p.slug, i."productSlug")) AS slug, MAX(COALESCE(p.title, i.title)) AS title,
                SUM(i.qty)::int AS units, SUM(i.price * i.qty)::bigint AS revenue, SUM(i."returnedQty")::int AS returned
         FROM shipments s JOIN shipment_items i ON i."shipmentId" = s.id
         LEFT JOIN product_variants v ON v.id = i."variantId" LEFT JOIN products p ON p.id = v."productId"
         WHERE s."supplierId" = $1::uuid AND s."paidAt" >= $2 AND s.status NOT IN ('awaiting_payment', 'cancelled', 'rejected')
         GROUP BY COALESCE(p.id::text, i."productSlug", i.title) ORDER BY revenue DESC, units DESC LIMIT 10`,
        supplierId, from,
      ),
      this.prisma.$queryRawUnsafe<{ views: bigint | null; cartAdds: bigint | null }[]>(
        `SELECT SUM(d.views)::bigint AS views, SUM(d."cartAdds")::bigint AS "cartAdds"
         FROM product_daily_stats d JOIN products p ON p.id = d."productId"
         WHERE p."supplierId" = $1::uuid AND d.day >= $2::date`,
        supplierId, firstDay,
      ),
      // Капсулы — текущее состояние: в скольких капсулах покупателей товар сейчас стоит (основная позиция слота)
      this.prisma.$queryRawUnsafe<CapsuleRow[]>(
        `SELECT p.id::text AS "productId", p.slug, p.title, COUNT(*)::int AS hits, COUNT(*) FILTER (WHERE COALESCE(v.stock, 0) <= 0)::int AS "zeroHits",
                (SELECT COALESCE(SUM(GREATEST(pv.stock, 0)), 0)::int FROM product_variants pv WHERE pv."productId" = p.id) AS stock
         FROM capsule_items ci JOIN products p ON p.id = ci."productId" LEFT JOIN product_variants v ON v.id = ci."variantId"
         WHERE p."supplierId" = $1::uuid GROUP BY p.id ORDER BY hits DESC, p.title LIMIT 10`,
        supplierId,
      ),
      // Нулевой остаток у варианта, выбранного в капсуле, — покупатель видит «нет в наличии»
      this.prisma.$queryRawUnsafe<CapsuleRow[]>(
        `SELECT p.id::text AS "productId", p.slug, p.title, COUNT(*)::int AS hits, COUNT(*) FILTER (WHERE COALESCE(v.stock, 0) <= 0)::int AS "zeroHits",
                (SELECT COALESCE(SUM(GREATEST(pv.stock, 0)), 0)::int FROM product_variants pv WHERE pv."productId" = p.id) AS stock
         FROM capsule_items ci JOIN products p ON p.id = ci."productId" LEFT JOIN product_variants v ON v.id = ci."variantId"
         WHERE p."supplierId" = $1::uuid GROUP BY p.id HAVING COUNT(*) FILTER (WHERE COALESCE(v.stock, 0) <= 0) > 0
         ORDER BY "zeroHits" DESC, hits DESC, p.title LIMIT 10`,
        supplierId,
      ),
    ]);

    // Ряд по дням без пропусков
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const series: { day: string; revenue: number; units: number; orders: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = moscowDay(new Date(now.getTime() - i * DAY));
      const d = byDay.get(day);
      series.push({ day, revenue: Number(d?.revenue ?? 0), units: d?.units ?? 0, orders: d?.orders ?? 0 });
    }
    const t = totals[0];
    const units = t?.units ?? 0;
    const views = Number(funnel[0]?.views ?? 0);
    const cartAdds = Number(funnel[0]?.cartAdds ?? 0);
    const capsuleRow = (r: CapsuleRow) => ({ productId: r.productId, slug: r.slug, title: r.title, hits: r.hits, zeroHits: r.zeroHits, stock: r.stock });
    return {
      days,
      from: firstDay,
      to: today,
      totals: {
        revenue: Number(t?.revenue ?? 0),
        units,
        orders: t?.orders ?? 0,
        avgOrder: t?.orders ? Math.round(Number(t.revenue ?? 0) / t.orders) : 0,
        returnedUnits: t?.returned ?? 0,
        returnedSum: Number(t?.returnedSum ?? 0),
        /** Доля возвратов по штукам, 0…1 */
        returnRate: units ? (t?.returned ?? 0) / units : 0,
      },
      series,
      top: top.map((r) => ({ productId: r.productId, slug: r.slug, title: r.title, units: r.units, revenue: Number(r.revenue), returned: r.returned })),
      funnel: {
        /** Счётчик просмотров ещё не подключён или просмотров нет — воронка начинается с корзины */
        viewsTracked: views > 0,
        views,
        cartAdds,
        /** Строки заказов (товар × вариант) — сопоставимо с добавлениями в корзину */
        orderLines: t?.lines ?? 0,
        orders: t?.orders ?? 0,
      },
      capsules: capsules.map(capsuleRow),
      zeroInCapsules: zeroInCapsules.map(capsuleRow),
    };
  }
}
