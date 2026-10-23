/**
 * Данные для нагрузочного теста (ТЗ §11): 100 поставщиков, ~6 250 товаров, 50 000 вариантов.
 * Только в отдельную базу: DATABASE_URL=…/aesculap_load pnpm --filter @aesculap/api load:seed
 */
import { HEIGHT_RANGES } from '@aesculap/shared';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_load')) {
  console.error('Нагрузочные данные пишутся только в базу *_load');
  process.exit(1);
}

const WORDS = ['Костюм', 'Топ', 'Брюки', 'Халат', 'Блуза', 'Жилет', 'Сабо', 'Шапочка', 'Куртка', 'Туника'];
const NAMES = ['Классика', 'Актив', 'Комфорт', 'Хирург', 'Стиль', 'Премиум', 'Базис', 'Аврора', 'Элит', 'Спорт', 'Лайт', 'Про', 'Мед', 'Ритм', 'Смена'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const HEIGHTS = [...HEIGHT_RANGES];
const pick = <T,>(a: T[], i: number) => a[i % a.length];
/** Детерминированный ГПСЧ (mulberry32): размеры, ростовки, цвета и категории независимы друг от друга. */
let seed = 42;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const any = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

async function main() {
  const [categories, colors, specialties] = await Promise.all([prisma.category.findMany(), prisma.color.findMany(), prisma.specialty.findMany()]);
  if (!categories.length) throw new Error('Сначала pnpm prisma:seed для этой базы');
  await prisma.$executeRawUnsafe('TRUNCATE products, suppliers, brands CASCADE');

  const brands = Array.from({ length: 30 }, (_, i) => ({ id: randomUUID(), name: `Бренд ${i + 1}`, slug: `brand-${i + 1}` }));
  await prisma.brand.createMany({ data: brands });
  const suppliers = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(), legalName: `ООО «Поставщик ${i + 1}»`, inn: String(7700000000 + i), status: 'active' as const, payoutStatus: 'active' as const,
    yookassaAccountId: `load-${i}`, cdekCityCode: pick([44, 137, 424], i), warehouseAddress: 'Москва', shipDays: 1,
  }));
  await prisma.supplier.createMany({ data: suppliers });

  const leaf = categories.filter((c) => c.parentId || !categories.some((x) => x.parentId === c.id));
  const TOTAL_VARIANTS = 50_000;
  let variants = 0;
  let n = 0;
  while (variants < TOTAL_VARIANTS) {
    const products = [];
    const vs = [];
    const specs = [];
    const media = [];
    for (let k = 0; k < 500 && variants < TOTAL_VARIANTS; k++, n++) {
      const id = randomUUID();
      const sup = pick(suppliers, n);
      const title = `${pick(WORDS, n)} «${pick(NAMES, Math.floor(n / 10))}» ${n}`;
      products.push({
        id, supplierId: sup.id, brandId: pick(brands, n * 7).id, categoryId: any(leaf).id, title, slug: `load-${n}`,
        gender: any(['female', 'male', 'unisex'] as const), fabric: '65% ПЭ · 35% хлопок', treatment: 'Антибактериальная', washing: 'до 60°',
        description: `${title} — нагрузочные данные.`, moderationStatus: 'published' as const, publishedAt: new Date(Date.now() - n * 60_000),
      });
      specs.push({ productId: id, specialtyId: any(specialties).id }, { productId: id, specialtyId: any(specialties).id });
      media.push({ productId: id, type: 'photo' as const, storageKey: `public/load/${n % 50}.webp`, isMain: true, approved: true, position: 0 });
      const shoes = ['kroksy', 'obuv'].includes(leaf.find((c) => c.id === products.at(-1)!.categoryId)!.slug);
      const base = 1500 + Math.floor(rnd() * 6000);
      const palette = [any(colors), any(colors)];
      for (let c = 0; c < 2; c++)
        for (let s = 0; s < 4; s++) {
          vs.push({
            productId: id, sku: `L${n}-${c}${s}`, size: shoes ? String(36 + Math.floor(rnd() * 8)) : any(SIZES), heightRange: shoes ? null : any(HEIGHTS), colorId: palette[c].id,
            price: (base + s * 100) * 100, oldPrice: n % 5 === 0 ? (base + 1500) * 100 : null, stock: Math.floor(rnd() * 9), weightG: 500,
          });
          variants++;
        }
    }
    await prisma.product.createMany({ data: products });
    await prisma.productVariant.createMany({ data: vs });
    await prisma.productSpecialty.createMany({ data: specs, skipDuplicates: true });
    await prisma.productMedia.createMany({ data: media });
    process.stdout.write(`\r${variants} вариантов`);
  }
  await prisma.$executeRawUnsafe('ANALYZE');
  console.log(`\nГотово: ${n} товаров, ${variants} вариантов, ${suppliers.length} поставщиков.`);
}

main().finally(() => prisma.$disconnect());
