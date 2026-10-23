/**
 * Демо-наполнение витрины для разработки и показа: поставщик «МедТекс (демо)», товары из прототипа,
 * статьи и подборка. Фото — нарисованные иллюстрации (SVG → WebP), не реальные снимки.
 * Запуск: pnpm --filter @aesculap/api db:demo. Повторный запуск пересоздаёт демо-данные.
 */
import { PrismaClient, type Gender } from '@prisma/client';
import * as argon2 from 'argon2';
import { repriceSales } from '../src/promotions/price';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const prisma = new PrismaClient();
const ROOT = resolve(process.env.STORAGE_LOCAL_DIR ?? './.storage');
const DEMO_INN = '7710000008';
/** Пароль демо-аккаунтов поставщиков на dev-стенде; в проде демо не запускается. */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-aesculap-2026';
/** Второй демо-поставщик со складом в Санкт-Петербурге — чтобы заказ делился на отправления. */
const DEMO_INN_2 = '7810000002';
const SPB_BRANDS = ['Форма+', 'ART MED', 'AVEMED'];

const put = async (key: string, data: Buffer) => {
  const full = resolve(ROOT, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
};

type Kind = 'suit' | 'top' | 'pants' | 'gown' | 'shoes' | 'cap';
function svg(kind: Kind, hex: string, angle: number): string {
  const shade = angle === 1 ? 0.92 : angle === 2 ? 0.84 : 1;
  const bg = ['#EEF1EE', '#E9EEEA', '#F1EFEA'][angle % 3];
  const body: Record<Kind, string> = {
    top: `<path d="M210 190 L330 150 Q400 200 470 150 L590 190 L640 330 L560 360 L545 300 L545 640 L255 640 L255 300 L240 360 L160 330 Z"/><path d="M360 160 L400 230 L440 160" fill="none" stroke="#0002" stroke-width="6"/><rect x="290" y="420" width="90" height="70" rx="6" fill="#0001"/>`,
    pants: `<path d="M260 140 L540 140 L575 690 L455 690 L400 330 L345 690 L225 690 Z"/><rect x="260" y="140" width="280" height="40" fill="#0002"/>`,
    suit: `<path d="M220 110 L330 80 Q400 120 470 80 L580 110 L620 220 L555 240 L545 200 L545 420 L255 420 L255 200 L245 240 L180 220 Z"/><path d="M265 430 L535 430 L560 720 L455 720 L400 520 L345 720 L240 720 Z" opacity="0.92"/>`,
    gown: `<path d="M240 120 L340 90 L400 160 L460 90 L560 120 L620 320 L560 340 L560 720 L240 720 L240 340 L180 320 Z" fill="#FFFFFF" stroke="#C9D0CC" stroke-width="4"/><path d="M340 90 L400 260 L460 90" fill="none" stroke="#C9D0CC" stroke-width="5"/><circle cx="400" cy="330" r="7" fill="#C9D0CC"/><circle cx="400" cy="420" r="7" fill="#C9D0CC"/><circle cx="400" cy="510" r="7" fill="#C9D0CC"/>`,
    shoes: `<path d="M150 470 Q160 380 260 370 L420 360 Q520 360 600 430 Q650 470 640 520 L170 530 Q140 520 150 470 Z"/><rect x="160" y="520" width="490" height="34" rx="14" fill="#9AA29E"/><circle cx="330" cy="420" r="9" fill="#0002"/><circle cx="380" cy="415" r="9" fill="#0002"/><circle cx="430" cy="415" r="9" fill="#0002"/>`,
    cap: `<path d="M210 450 Q200 230 400 220 Q600 230 590 450 Z"/><rect x="200" y="440" width="400" height="60" rx="20" opacity="0.85"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="${bg}"/><ellipse cx="400" cy="760" rx="260" ry="18" fill="#0000000f"/><g fill="${hex}" transform="translate(400 400) scale(${shade}) translate(-400 -400)">${body[kind]}</g></svg>`;
}

async function photo(productId: string, kind: Kind, hex: string, angle: number, colorId: string | null = null, position = angle) {
  const id = randomUUID();
  const key = `public/products/${productId}/${id}.webp`;
  const img = sharp(Buffer.from(svg(kind, hex, angle)));
  await put(key, await img.clone().resize(1200, 1200).webp({ quality: 82 }).toBuffer());
  await put(key.replace(/\.webp$/, '_thumb.webp'), await img.clone().resize(600, 800, { fit: 'cover' }).webp({ quality: 78 }).toBuffer());
  return { id, productId, type: 'photo' as const, storageKey: key, position, isMain: position === 0, approved: true, width: 1200, height: 1200, colorId };
}

async function cover(kind: Kind, hex: string) {
  const key = `public/content/${randomUUID()}.webp`;
  await put(key, await sharp(Buffer.from(svg(kind, hex, 0))).resize(1600, 900, { fit: 'cover' }).webp({ quality: 80 }).toBuffer());
  return key;
}

type Item = { title: string; brand: string; category: string; kind: Kind; gender: Gender; color: string; price: number; oldPrice?: number; sizes: string[]; heights?: string[]; fabric?: string; specialties: string[] };

const ITEMS: Item[] = [
  { title: 'Костюм «Хирург»', brand: 'МедТекс', category: 'kostyumy', kind: 'suit', gender: 'unisex', color: 'Бирюзовый', price: 4590, oldPrice: 5290, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176', '176–182'], fabric: '65% ПЭ · 35% хлопок', specialties: ['Хирург', 'Стоматолог-хирург'] },
  { title: 'Халат женский «Классика»', brand: 'Форма+', category: 'halaty', kind: 'gown', gender: 'female', color: 'Белый', price: 3490, oldPrice: 4290, sizes: ['XS', 'S', 'M', 'L'], heights: ['164–170', '170–176'], fabric: '100% хлопок', specialties: ['Терапевт', 'Педиатр'] },
  { title: 'Брюки джоггеры', brand: 'МедТекс', category: 'bryuki', kind: 'pants', gender: 'unisex', color: 'Тёмно-синий', price: 2290, oldPrice: 2690, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], fabric: '72% ПЭ · 23% вискоза · 5% эластан', specialties: ['Медсестра', 'Терапевт'] },
  { title: 'Сабо ортопедические', brand: 'ПрофиМед', category: 'kroksy', kind: 'shoes', gender: 'unisex', color: 'Белый', price: 3990, sizes: ['37', '38', '39', '40', '41'], specialties: ['Хирург', 'Операционная медсестра'] },
  { title: 'Костюм женский «Аврора»', brand: 'Аврора Мед', category: 'kostyumy', kind: 'suit', gender: 'female', color: 'Лаванда', price: 3890, sizes: ['XS', 'S', 'M', 'L'], heights: ['164–170', '170–176'], fabric: '65% ПЭ · 35% хлопок', specialties: ['Косметолог', 'Педиатр'] },
  { title: 'Костюм «Премиум»', brand: 'МедТекс', category: 'kostyumy', kind: 'suit', gender: 'unisex', color: 'Графит', price: 4890, sizes: ['M', 'L', 'XL'], heights: ['170–176', '176–182'], fabric: 'Микрофибра с антибактериальной пропиткой', specialties: ['Главный врач', 'Заведующий отделением'] },
  { title: 'Брюки «Актив»', brand: 'LITTO', category: 'bryuki', kind: 'pants', gender: 'unisex', color: 'Оливковый', price: 3490, sizes: ['M', 'L', 'XL'], heights: ['176–182'], specialties: ['Хирург'] },
  { title: 'Топ «Актив»', brand: 'ART MED', category: 'topy', kind: 'top', gender: 'female', color: 'Персиковый', price: 2990, sizes: ['S', 'M', 'L'], heights: ['170–176'], specialties: ['Стоматолог-терапевт'] },
  { title: 'Халат «Доктор»', brand: 'МедТекс', category: 'halaty', kind: 'gown', gender: 'unisex', color: 'Молочный', price: 6290, sizes: ['M', 'L', 'XL'], heights: ['170–176'], specialties: ['Терапевт', 'Кардиолог'] },
  { title: 'Костюм «Базис»', brand: 'LITTO', category: 'kostyumy', kind: 'suit', gender: 'unisex', color: 'Серый', price: 3990, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], specialties: ['Лаборант', 'Врач УЗИ'] },
  { title: 'Топ «Комфорт»', brand: 'МедТекс', category: 'topy', kind: 'top', gender: 'unisex', color: 'Бирюзовый', price: 4590, sizes: ['M', 'L'], heights: ['170–176'], specialties: ['Медсестра'] },
  { title: 'Сабо «Принт»', brand: 'AVEMED', category: 'kroksy', kind: 'shoes', gender: 'female', color: 'Тёмно-синий', price: 3290, oldPrice: 3790, sizes: ['36', '37', '38', '39'], specialties: ['Педиатр', 'Детская медсестра'] },
  { title: 'Халат «Классик»', brand: 'ART MED', category: 'halaty', kind: 'gown', gender: 'male', color: 'Белый', price: 5890, sizes: ['L', 'XL', 'XXL'], heights: ['176–182', '182–188'], specialties: ['Терапевт', 'Невролог'] },
  { title: 'Топ «Элит»', brand: 'LITTO', category: 'topy', kind: 'top', gender: 'male', color: 'Голубой', price: 2490, sizes: ['M', 'L', 'XL'], heights: ['176–182'], specialties: ['Врач УЗИ', 'Анестезиолог'] },
  { title: 'Костюм «Стиль»', brand: 'МедТекс', category: 'kostyumy', kind: 'suit', gender: 'female', color: 'Лаванда', price: 4190, oldPrice: 4790, sizes: ['XS', 'S', 'M'], heights: ['164–170'], specialties: ['Косметолог', 'Дерматолог'] },
  { title: 'Шапочка-колпак', brand: 'МедТекс', category: 'golovnye-ubory', kind: 'cap', gender: 'unisex', color: 'Бирюзовый', price: 490, sizes: ['M'], specialties: ['Хирург', 'Операционная медсестра'] },
  { title: 'Костюм «Стоматолог»', brand: 'Форма+', category: 'kostyumy', kind: 'suit', gender: 'unisex', color: 'Мятный', price: 4190, oldPrice: 4990, sizes: ['S', 'M', 'L'], heights: ['170–176'], specialties: ['Стоматолог-терапевт', 'Ассистент'] },
  { title: 'Блуза «Комфорт»', brand: 'Форма+', category: 'topy', kind: 'top', gender: 'female', color: 'Мятный', price: 2990, oldPrice: 3590, sizes: ['XS', 'S', 'M'], heights: ['164–170'], specialties: ['Стоматолог-терапевт', 'Ассистент'] },
];

const slug = (s: string) =>
  s.toLowerCase().replace(/[«»"]/g, '').replace(/ё/g, 'е').replace(/[а-я]/g, (c) => 'a b v g d e zh z i y k l m n o p r s t u f h ts ch sh sch  y  e yu ya'.split(' ')['абвгдежзийклмнопрстуфхцчшщъыьэюя'.indexOf(c)] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  // Повторный запуск: убираем прежних демо-поставщиков целиком (каскадом товары, статьи, подборки, их заказы).
  for (const [inn, legalName] of [[DEMO_INN, 'ООО «МедТекс» (демо)'], [DEMO_INN_2, 'ООО «Форма+» (демо)']]) {
    const old = await prisma.supplier.findFirst({ where: { inn, legalName }, include: { products: { select: { id: true } } } });
    if (old) {
      for (const p of old.products) await rm(resolve(ROOT, 'public/products', p.id), { recursive: true, force: true });
      await prisma.order.deleteMany({ where: { shipments: { some: { supplierId: old.id } } } });
      await prisma.product.deleteMany({ where: { supplierId: old.id } });
      await prisma.supplier.delete({ where: { id: old.id } });
    }
    if (await prisma.supplier.findUnique({ where: { inn } })) {
      console.error(`ИНН ${inn} уже занят не демо-поставщиком — демо не создаю.`);
      process.exit(1);
    }
  }
  const demoPayout = { status: 'active' as const, payoutStatus: 'active' as const, shipDays: 1, contactPhone: '+79990000000', payoutLegalName: 'демо', payoutInn: DEMO_INN, payoutAccount: '40702810900000000001', payoutBik: '044525225' };
  const supplier = await prisma.supplier.create({
    data: { ...demoPayout, legalName: 'ООО «МедТекс» (демо)', inn: DEMO_INN, yookassaAccountId: 'demo-medteks', warehouseAddress: 'Москва, Складочная 1с5', cdekCityCode: 44, cdekShipmentPoint: 'MSK65', description: 'Производитель медодежды' },
  });
  const supplierSpb = await prisma.supplier.create({
    data: { ...demoPayout, legalName: 'ООО «Форма+» (демо)', inn: DEMO_INN_2, yookassaAccountId: 'demo-formaplus', warehouseAddress: 'Санкт-Петербург, Лиговский пр-т 50', cdekCityCode: 137, cdekShipmentPoint: 'SPB1', description: 'Халаты, блузы и обувь' },
  });
  // Входы в кабинеты демо-поставщиков — только для dev-стенда (пароль DEMO_PASSWORD, см. README).
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  for (const [email, s] of [['demo.msk@example.ru', supplier], ['demo.spb@example.ru', supplierSpb]] as const) {
    const u = await prisma.user.upsert({ where: { email }, update: { passwordHash }, create: { email, role: 'supplier_staff', passwordHash, emailVerifiedAt: new Date() } });
    await prisma.supplierMember.create({ data: { supplierId: s.id, userId: u.id, role: 'owner' } });
  }
  const [categories, colors, specialties] = await Promise.all([prisma.category.findMany(), prisma.color.findMany(), prisma.specialty.findMany()]);
  const colorHex = new Map(colors.map((c) => [c.name, c]));

  const created: { id: string; item: Item }[] = [];
  for (const [n, item] of ITEMS.entries()) {
    const brand = await prisma.brand.upsert({ where: { name: item.brand }, update: {}, create: { name: item.brand, slug: slug(item.brand) || `brand-${n}` } });
    const category = categories.find((c) => c.slug === item.category)!;
    const color = colorHex.get(item.color)!;
    const second = colors.find((c) => c.name === (color.name === 'Белый' ? 'Графит' : 'Белый'))!;
    const p = await prisma.product.create({
      data: {
        supplierId: SPB_BRANDS.includes(item.brand) ? supplierSpb.id : supplier.id, brandId: brand.id, categoryId: category.id, title: item.title, slug: `${slug(item.title)}-${n + 1}`,
        gender: item.gender, fabric: item.fabric ?? '65% ПЭ · 35% хлопок', treatment: 'Антибактериальная', washing: 'до 60° · 600+ циклов',
        description: `${item.title} — эластичная медицинская одежда для активного рабочего дня. Мягкая ткань сохраняет аккуратную посадку и легко комбинируется с другими вещами капсулы.`,
        moderationStatus: 'published', publishedAt: new Date(Date.now() - n * 3600_000), source: 'manual',
        specialties: { create: specialties.filter((s) => item.specialties.includes(s.name)).map((s) => ({ specialtyId: s.id })) },
      },
    });
    const heights = item.heights ?? [null];
    let i = 0;
    for (const c of item.kind === 'gown' || item.kind === 'cap' ? [color] : [color, second]) {
      for (const size of item.sizes)
        for (const h of heights) {
          await prisma.productVariant.create({
            data: {
              productId: p.id, sku: `DM-${n + 1}-${String(i).padStart(2, '0')}-${size}`, size, heightRange: h, colorId: c.id,
              price: item.price * 100, oldPrice: item.oldPrice ? item.oldPrice * 100 : null, stock: (i * 7) % 13, weightG: 600, lengthMm: 300, widthMm: 250, heightMm: 50,
            },
          });
          i += 1;
        }
    }
    // Фото по цветам (ТЗ §4.3): у каждого цвета варианта — свои снимки
    const twoColors = !(item.kind === 'gown' || item.kind === 'cap');
    const shots = await Promise.all([
      ...[0, 1, 2].map((a) => photo(p.id, item.kind, color.hex, a, twoColors ? color.id : null)),
      ...(twoColors ? [0, 1].map((a) => photo(p.id, item.kind, second.hex, a, second.id, 3 + a)) : []),
    ]);
    await prisma.productMedia.createMany({ data: shots });
    created.push({ id: p.id, item });
  }

  const pick = (pred: (i: Item) => boolean) => created.filter((c) => pred(c.item)).map((c) => c.id);
  const article = (title: string, lead: string, body: string, kind: Kind, hex: string, productIds: string[]) =>
    cover(kind, hex).then((coverKey) =>
      prisma.article.create({
        data: { supplierId: supplier.id, slug: `${slug(title)}-demo`, title, lead, coverKey, body, status: 'published', publishedAt: new Date(), products: { create: productIds.map((productId, position) => ({ productId, position })) } },
      }),
    );
  await article(
    'Как выбрать форму для долгой смены',
    'Практические советы о посадке, ткани и рабочем ритме.',
    '<p>Ткань, обработка, режим стирки, крой и карманы — разбираем, на что смотреть при выборе костюма для смены.</p><h2>Ткань</h2><p>Смесовая ткань 65/35 с антибактериальной пропиткой выдерживает 600+ циклов стирки при 60° — это ключевое требование операционной.</p><h2>Посадка</h2><p>Свободный крой не сковывает движения, а эластан в брюках сохраняет форму к концу смены.</p><ul><li>Проверьте глубину карманов под телефон и ручки.</li><li>Выбирайте ростовку, а не только размер.</li></ul>',
    'suit', '#2A9D8F', pick((i) => i.kind === 'suit').slice(0, 3),
  );
  await article(
    'Уход за формой: стирка при 60°',
    'Как сохранить цвет и посадку после сотен стирок.',
    '<p>Медицинская одежда стирается чаще обычной — правильный режим продлевает её жизнь вдвое.</p><h2>Температура</h2><p>60° убивают большинство бактерий и не разрушают смесовые ткани. Белый халат можно стирать при 90°, если позволяет ярлык.</p><h2>Сушка</h2><p>Сушите на плечиках — так меньше гладить.</p>',
    'gown', '#F2EEE3', pick((i) => i.kind === 'gown'),
  );
  await prisma.collection.create({
    data: {
      supplierId: supplier.id, slug: 'podborka-forma-dlya-stomatologii-demo', title: 'Подборка: форма для стоматологии', description: 'Собранный комплект для спокойной рабочей смены.',
      coverKey: await cover('top', '#A8DCC1'), status: 'published', publishedAt: new Date(Date.now() - 60_000),
      products: { create: pick((i) => i.specialties.some((s) => s.startsWith('Стоматолог'))).map((productId, position) => ({ productId, position })) },
    },
  });
  // Акции: одна идёт (товары одобрены, цены снижены), вторая — в приёме заявок.
  await prisma.promotion.deleteMany({ where: { slug: { in: ['nedelya-hirurga-demo', 'osenniy-stomatolog-demo'] } } });
  const now = Date.now();
  const running = await prisma.promotion.create({
    data: {
      name: 'Неделя хирурга', slug: 'nedelya-hirurga-demo', badge: 'Неделя хирурга', description: 'Скидки на хирургические костюмы и шапочки.',
      minDiscountPct: 15, commissionBp: 800, onHomepage: true,
      applyFrom: new Date(now - 10 * 86400_000), applyTo: new Date(now - 3 * 86400_000), startsAt: new Date(now - 2 * 86400_000), endsAt: new Date(now + 5 * 86400_000),
    },
  });
  await prisma.promotion.create({
    data: {
      name: 'Осенний стоматолог', slug: 'osenniy-stomatolog-demo', badge: 'Осень −20%', description: 'Форма для стоматологии к сезону.',
      minDiscountPct: 20, commissionBp: 800, onHomepage: true, newsletter: true,
      applyFrom: new Date(now - 86400_000), applyTo: new Date(now + 6 * 86400_000), startsAt: new Date(now + 7 * 86400_000), endsAt: new Date(now + 21 * 86400_000),
    },
  });
  const surgical = await prisma.product.findMany({ where: { id: { in: pick((i) => i.specialties.includes('Хирург')) } } });
  for (const p of surgical) {
    await prisma.promotionProduct.create({ data: { promotionId: running.id, productId: p.id, supplierId: p.supplierId, discountPct: 20, status: 'approved', decidedAt: new Date() } });
  }
  await repriceSales(prisma);

  // Демо-админ для dev-стенда (пароль тот же DEMO_PASSWORD).
  await prisma.user.upsert({ where: { email: 'demo.admin@example.ru' }, update: { passwordHash }, create: { email: 'demo.admin@example.ru', role: 'admin', passwordHash, emailVerifiedAt: new Date() } });

  console.log(`Демо: ${created.length} товаров, 2 статьи, 1 подборка. Поставщики «${supplier.legalName}» и «${supplierSpb.legalName}».`);
}

main().finally(() => prisma.$disconnect());
