import type { PrismaClient } from '@prisma/client';

/**
 * Цена для покупателя (ТЗ §7.7): по акции — акционная, а цена поставщика становится «старой»;
 * без акции — как задал поставщик. Используется витриной, корзиной, капсулой и заказом.
 */
export function shown(v: { price: number; oldPrice: number | null; salePrice?: number | null }) {
  if (v.salePrice == null) return { price: v.price, oldPrice: v.oldPrice };
  return { price: v.salePrice, oldPrice: Math.max(v.price, v.oldPrice ?? 0) };
}

export const effective = (v: { price: number; salePrice?: number | null }) => v.salePrice ?? v.price;

/**
 * Пересчёт акционных цен у вариантов. Цена поставщика (price) не меняется — синк YML её обновляет,
 * а акционная цена пересчитывается от новой. Идёт раз в минуту и после любых изменений цен и заявок.
 */
export async function repriceSales(prisma: PrismaClient) {
  const best = `
    WITH best AS (
      SELECT DISTINCT ON (pp."productId") pp."productId", pp."discountPct", p.id AS "promotionId"
      FROM promotion_products pp JOIN promotions p ON p.id = pp."promotionId"
      WHERE pp.status = 'approved' AND p."startsAt" <= now() AND p."endsAt" > now() AND pp."discountPct" >= p."minDiscountPct"
      ORDER BY pp."productId", pp."discountPct" DESC
    )`;
  const set = await prisma.$executeRawUnsafe(`${best}
    UPDATE product_variants v
    SET "salePrice" = (CEIL(v.price * (100 - b."discountPct") / 10000.0) * 100)::int, "salePromotionId" = b."promotionId"
    FROM best b
    WHERE v."productId" = b."productId"
      AND (v."salePrice" IS DISTINCT FROM (CEIL(v.price * (100 - b."discountPct") / 10000.0) * 100)::int OR v."salePromotionId" IS DISTINCT FROM b."promotionId")`);
  const cleared = await prisma.$executeRawUnsafe(`${best}
    UPDATE product_variants v SET "salePrice" = NULL, "salePromotionId" = NULL
    WHERE (v."salePrice" IS NOT NULL OR v."salePromotionId" IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM best b WHERE b."productId" = v."productId")`);
  return { set, cleared };
}
