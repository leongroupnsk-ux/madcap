/**
 * Демо-наполнение витрины для разработки и показа: поставщики «МедТекс (демо)» и «Форма+ (демо)», товары из макета Figma,
 * статьи и подборка. Фото — снимки из макета (prisma/demo-assets, WebP), кладутся в хранилище как загруженные поставщиком.
 * Запуск: pnpm --filter @aesculap/api db:demo. Повторный запуск пересоздаёт демо-данные.
 */
import { PrismaClient, type Gender } from '@prisma/client';
import * as argon2 from 'argon2';
import { repriceSales } from '../src/promotions/price';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const prisma = new PrismaClient();
const ROOT = resolve(process.env.STORAGE_LOCAL_DIR ?? './.storage');
const DEMO_INN = '7710000008';
/** Пароль демо-аккаунтов поставщиков на dev-стенде; в проде демо не запускается. */
// На сервере пароль демо-входов обязателен и свой: общеизвестный пароль из кода там не годится
if (process.env.NODE_ENV === 'production' && (process.env.DEMO_PASSWORD ?? '').length < 12) {
  console.error('Задайте DEMO_PASSWORD (от 12 символов) в .env.production');
  process.exit(1);
}
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-aesculap-2026';
/** Второй демо-поставщик со складом в Санкт-Петербурге — чтобы заказ делился на отправления. */
const DEMO_INN_2 = '7810000002';
const SPB_BRANDS = ['Форма+', 'ART MED', 'AVEMED'];

const put = async (key: string, data: Buffer) => {
  const full = resolve(ROOT, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
};

/** Фото товаров из макета Figma «МедКапсула» (кадры .Main, .Catalog, .Catalog-rope, .Product card), WebP до 1600 px. */
const ASSETS = resolve(__dirname, 'demo-assets');
type Crop = { left: number; top: number; width: number; height: number };
type Shot = { file: string; thumbCrop?: Crop; crop?: Crop };
/** Кадрирование превью «Костюма «Хирург»» как в карточке каталога макета (фото увеличено на 131%). */
const HIRURG_CARD: Crop = { left: 119, top: 117, width: 782, height: 907 };
/** Поясная сумка — фрагмент снимка «Топ «Комфорт»». */
const POUCH: Crop = { left: 250, top: 830, width: 420, height: 460 };

async function photo(productId: string, shot: Shot, position: number, colorId: string | null) {
  const id = randomUUID();
  const key = `public/products/${productId}/${id}.webp`;
  const src = await readFile(resolve(ASSETS, `${shot.file}.webp`));
  const base = shot.crop ? sharp(src).extract(shot.crop) : sharp(src);
  const full = await base.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
  await put(key, full.data);
  // Превью под пропорции карточки товара (251 × 274 в макете)
  const thumbSrc = shot.thumbCrop ? sharp(src).extract(shot.thumbCrop) : base.clone();
  await put(key.replace(/\.webp$/, '_thumb.webp'), await thumbSrc.resize(640, 700, { fit: 'cover' }).webp({ quality: 80 }).toBuffer());
  return { id, productId, type: 'photo' as const, storageKey: key, position, isMain: position === 0, approved: true, width: full.info.width, height: full.info.height, sizeBytes: full.data.length, colorId };
}

/** Обложка статьи или подборки — снимок целиком (в макете квадратный), кадрирует витрина под свой формат. */
async function cover(file: string) {
  const key = `public/content/${randomUUID()}.webp`;
  await put(key, await sharp(await readFile(resolve(ASSETS, `${file}.webp`))).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
  return key;
}

type Item = {
  title: string; brand: string; category: string; gender: Gender; color: string; price: number; oldPrice?: number; sizes: string[]; heights?: string[];
  fabric?: string; specialties: string[]; photos: Shot[];
  /** Один цвет (халаты); иначе добавляется второй цвет — для подбора капсулы по палитре */
  oneColor?: boolean; second?: string;
  /** Участвует в демо-акции «Неделя хирурга» */
  promo?: boolean;
  /** Премиум-коллекция: участвует в премиальном подборе /premium */
  premium?: boolean;
  /** Все цвета товара (первый — цвет со снимка); иначе color + second */
  colors?: string[];
};

const H = ['170–176', '176–182'];
/** Галерея «Костюма «Хирург»» из кадра .Product card: спереди, сзади, ткань, посадка, сбоку, сложенный. */
const HIRURG_GALLERY: Shot[] = [
  { file: 'kostyum-hirurg', thumbCrop: HIRURG_CARD },
  { file: 'kostyum-hirurg-szadi' },
  { file: 'kostyum-hirurg-tkan' },
  { file: 'kostyum-hirurg-posadka' },
  { file: 'kostyum-hirurg-bok' },
  { file: 'kostyum-hirurg-slozhen' },
];
/**
 * Товары из макета: первые 15 — сетка кадра .Catalog в том же порядке (выдача «Рекомендуемые» — по дате публикации),
 * затем футболки из .Catalog-rope и вещи для слотов капсулы (брюки в цветах топов, аксессуар) — на тех же фото.
 */
const ITEMS: Item[] = [
  { title: 'Костюм «Хирург»', brand: 'МедТекс', category: 'kostyumy', gender: 'unisex', color: 'Бирюзовый', price: 4590, oldPrice: 5290, sizes: ['S', 'M', 'L', 'XL'], heights: H, fabric: '65% ПЭ · 35% хлопок', specialties: ['Хирург', 'Стоматолог-хирург'], photos: HIRURG_GALLERY },
  { title: 'Костюм «Премиум»', brand: 'МедТекс', category: 'kostyumy', gender: 'unisex', color: 'Шалфей', price: 4890, sizes: ['M', 'L', 'XL'], heights: H, fabric: 'Микрофибра с антибактериальной пропиткой', specialties: ['Главный врач', 'Заведующий отделением'], photos: [{ file: 'kostyum-premium' }], promo: true , premium: true },
  { title: 'Халат женский «Классика»', brand: 'Форма+', category: 'halaty', gender: 'female', color: 'Белый', price: 3490, oldPrice: 4290, sizes: ['XS', 'S', 'M', 'L'], heights: ['164–170', '170–176'], fabric: '100% хлопок', specialties: ['Терапевт', 'Педиатр'], photos: [{ file: 'halat-klassika' }], oneColor: true },
  { title: 'Брюки джоггеры', brand: 'МедТекс', category: 'bryuki', gender: 'unisex', color: 'Тёмно-синий', price: 2290, oldPrice: 2690, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], fabric: '72% ПЭ · 23% вискоза · 5% эластан', specialties: ['Медсестра', 'Терапевт'], photos: [{ file: 'bryuki-joggery' }] },
  { title: 'Сабо ортопедические', brand: 'ПрофиМед', category: 'kroksy', gender: 'unisex', color: 'Белый', price: 3990, sizes: ['37', '38', '39', '40', '41'], fabric: 'EVA, антискользящая подошва', specialties: ['Хирург', 'Операционная медсестра'], photos: [{ file: 'sabo-belye' }] },
  { title: 'Костюм женский «Аврора»', brand: 'Аврора Мед', category: 'kostyumy', gender: 'female', color: 'Лаванда', price: 3890, sizes: ['XS', 'S', 'M', 'L'], heights: ['164–170', '170–176'], specialties: ['Косметолог', 'Педиатр'], photos: [{ file: 'kostyum-avrora' }] },
  { title: 'Брюки «Актив»', brand: 'LITTO', category: 'bryuki', gender: 'unisex', color: 'Оливковый', price: 3490, sizes: ['M', 'L', 'XL'], heights: ['176–182'], specialties: ['Хирург'], photos: [{ file: 'bryuki-aktiv' }] },
  { title: 'Топ «Актив»', brand: 'ART MED', category: 'topy', gender: 'female', color: 'Персиковый', price: 2990, sizes: ['S', 'M', 'L'], heights: ['170–176'], specialties: ['Стоматолог-терапевт'], photos: [{ file: 'top-aktiv' }, { file: 'top-aktiv-b' }] },
  { title: 'Халат «Доктор»', brand: 'МедТекс', category: 'halaty', gender: 'unisex', color: 'Молочный', price: 6290, sizes: ['M', 'L', 'XL'], heights: ['170–176'], specialties: ['Терапевт', 'Кардиолог'], photos: [{ file: 'halat-doktor' }, { file: 'halat-doktor-b' }], oneColor: true , premium: true },
  { title: 'Костюм «Базис»', brand: 'LITTO', category: 'kostyumy', gender: 'unisex', color: 'Серый', price: 3990, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], specialties: ['Лаборант', 'Врач УЗИ'], photos: [{ file: 'kostyum-bazis' }, { file: 'kostyum-bazis-b' }] },
  { title: 'Топ «Комфорт»', brand: 'МедТекс', category: 'topy', gender: 'unisex', color: 'Бирюзовый', price: 4590, sizes: ['M', 'L'], heights: ['170–176'], specialties: ['Медсестра'], photos: [{ file: 'top-komfort' }, { file: 'top-komfort-b' }] , premium: true },
  { title: 'Сабо ортопедические', brand: 'AVEMED', category: 'kroksy', gender: 'female', color: 'Тёмно-синий', price: 3290, oldPrice: 3790, sizes: ['36', '37', '38', '39'], fabric: 'EVA, принт', specialties: ['Педиатр', 'Детская медсестра'], photos: [{ file: 'sabo-print' }] },
  { title: 'Халат «Классик»', brand: 'ART MED', category: 'halaty', gender: 'male', color: 'Белый', price: 5890, sizes: ['L', 'XL', 'XXL'], heights: ['176–182', '182–188'], specialties: ['Терапевт', 'Невролог'], photos: [{ file: 'halat-klassik' }], oneColor: true },
  { title: 'Топ «Элит»', brand: 'LITTO', category: 'topy', gender: 'male', color: 'Голубой', price: 2490, sizes: ['M', 'L', 'XL'], heights: ['176–182'], specialties: ['Врач УЗИ', 'Анестезиолог'], photos: [{ file: 'top-elit' }, { file: 'top-elit-b' }] },
  { title: 'Костюм «Стиль»', brand: 'МедТекс', category: 'kostyumy', gender: 'female', color: 'Лаванда', price: 4190, oldPrice: 4790, sizes: ['XS', 'S', 'M'], heights: ['164–170'], specialties: ['Косметолог', 'Дерматолог'], photos: [{ file: 'kostyum-stil' }] },
  // Кадр .Catalog-rope (Каталог → Футболки)
  { title: 'Футболка «Хирург»', brand: 'МедТекс', category: 'futbolki', gender: 'unisex', color: 'Бирюзовый', price: 4590, oldPrice: 5290, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], specialties: ['Хирург', 'Операционная медсестра'], photos: [{ file: 'kostyum-hirurg', thumbCrop: HIRURG_CARD }, { file: 'kostyum-hirurg-b' }] },
  { title: 'Футболка «Стиль»', brand: 'МедТекс', category: 'futbolki', gender: 'unisex', color: 'Бирюзовый', price: 4590, oldPrice: 5290, sizes: ['S', 'M', 'L'], heights: ['170–176'], specialties: ['Медсестра'], photos: [{ file: 'kostyum-premium' }, { file: 'kostyum-hirurg-b' }] },
  { title: 'Футболка «Аврора»', brand: 'Аврора Мед', category: 'futbolki', gender: 'female', color: 'Лаванда', price: 3890, sizes: ['XS', 'S', 'M', 'L'], heights: ['164–170', '170–176'], specialties: ['Косметолог', 'Педиатр'], photos: [{ file: 'kostyum-avrora' }] },
  { title: 'Футболка «Базис»', brand: 'LITTO', category: 'futbolki', gender: 'unisex', color: 'Серый', price: 3990, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], specialties: ['Лаборант', 'Врач УЗИ'], photos: [{ file: 'kostyum-bazis' }, { file: 'kostyum-bazis-b' }] },
  // Вещи для слотов капсулы: брюки в цветах топов и аксессуар — на фото макета
  { title: 'Брюки «Хирург»', brand: 'МедТекс', category: 'bryuki', gender: 'unisex', color: 'Бирюзовый', price: 2490, sizes: ['S', 'M', 'L', 'XL'], heights: H, specialties: ['Хирург', 'Операционная медсестра'], photos: [{ file: 'kostyum-hirurg-b' }, { file: 'kostyum-hirurg', thumbCrop: HIRURG_CARD }], promo: true , premium: true },
  { title: 'Брюки «Аврора»', brand: 'Аврора Мед', category: 'bryuki', gender: 'female', color: 'Лаванда', price: 2390, sizes: ['XS', 'S', 'M', 'L'], heights: ['164–170', '170–176'], specialties: ['Косметолог', 'Педиатр'], photos: [{ file: 'kostyum-avrora' }] },
  { title: 'Брюки «Базис»', brand: 'LITTO', category: 'bryuki', gender: 'unisex', color: 'Серый', price: 2190, sizes: ['S', 'M', 'L', 'XL'], heights: ['170–176'], specialties: ['Лаборант', 'Врач УЗИ'], photos: [{ file: 'kostyum-bazis-b' }] },
  { title: 'Костюм «Стоматолог»', brand: 'Форма+', category: 'kostyumy', gender: 'unisex', color: 'Мятный', price: 4190, oldPrice: 4990, sizes: ['S', 'M', 'L'], heights: ['170–176'], specialties: ['Стоматолог-терапевт', 'Ассистент'], photos: [{ file: 'top-komfort' }, { file: 'top-elit-b' }] },
  { title: 'Блуза «Комфорт»', brand: 'Форма+', category: 'topy', gender: 'female', color: 'Мятный', price: 2990, oldPrice: 3590, sizes: ['XS', 'S', 'M'], heights: ['164–170'], specialties: ['Стоматолог-терапевт', 'Ассистент'], photos: [{ file: 'top-elit-b' }] },
  { title: 'Сумка поясная «Смена»', brand: 'МедТекс', category: 'aksessuary', gender: 'unisex', color: 'Графит', second: 'Тёмно-синий', price: 1490, sizes: ['ONE'], fabric: 'Нейлон с водоотталкивающей пропиткой', specialties: ['Медсестра', 'Хирург'], photos: [{ file: 'top-komfort', crop: POUCH }], promo: true , premium: true },
  // Премиум-коллекция из кадра .Premium-capsule: капсула «Тёмно-синяя» и ещё две цветовые группы у топа и брюк
  { title: 'Топ «Уют»', brand: 'МедТекс', category: 'topy', gender: 'unisex', color: 'Тёмно-синий', colors: ['Тёмно-синий', 'Графит', 'Шалфей'], price: 4590, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], fabric: 'Микромодал 92% · эластан 8%', specialties: ['Хирург', 'Терапевт', 'Стоматолог-терапевт', 'Медсестра'], photos: [{ file: 'top-uyut' }], premium: true },
  { title: 'Брюки «Уют»', brand: 'МедТекс', category: 'bryuki', gender: 'unisex', color: 'Тёмно-синий', colors: ['Тёмно-синий', 'Графит', 'Шалфей'], price: 4230, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], fabric: 'Микромодал 92% · эластан 8%', specialties: ['Хирург', 'Терапевт', 'Стоматолог-терапевт', 'Медсестра'], photos: [{ file: 'bryuki-uyut' }], premium: true },
  { title: 'Халат «Классика»', brand: 'МедТекс', category: 'halaty', gender: 'unisex', color: 'Белый', price: 3890, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], fabric: 'Хлопок 60% · полиэстер 40%, сатин', specialties: ['Терапевт', 'Главный врач', 'Педиатр'], photos: [{ file: 'halat-klassika-premium' }], oneColor: true, premium: true },
  { title: 'Сабо «Light»', brand: 'ПрофиМед', category: 'kroksy', gender: 'unisex', color: 'Белый', price: 5590, sizes: ['36', '37', '38', '39', '40', '41', '42', '43', '44'], fabric: 'Перфорированная кожа, анатомическая стелька', specialties: ['Хирург', 'Операционная медсестра', 'Терапевт'], photos: [{ file: 'sabo-light' }], oneColor: true, premium: true },
  { title: 'Бейдж', brand: 'МедТекс', category: 'aksessuary', gender: 'unisex', color: 'Тёмно-синий', colors: ['Тёмно-синий', 'Графит', 'Шалфей', 'Серый'], price: 490, sizes: ['ONE'], fabric: 'Металл, ретрактор с карабином', specialties: ['Хирург', 'Терапевт', 'Медсестра', 'Стоматолог-терапевт', 'Педиатр'], photos: [{ file: 'beydzh' }], premium: true },
];

/** Слаги демо-статей редакции (автор — платформа). */
const EDITORIAL_SLUGS = ['uhod-za-formoy-stirka-pri-60-demo'];

const slug = (s: string) =>
  s.toLowerCase().replace(/[«»"]/g, '').replace(/ё/g, 'е').replace(/[а-я]/g, (c) => 'a b v g d e zh z i y k l m n o p r s t u f h ts ch sh sch  y  e yu ya'.split(' ')['абвгдежзийклмнопрстуфхцчшщъыьэюя'.indexOf(c)] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  // Повторный запуск: убираем прежних демо-поставщиков целиком (каскадом товары, статьи, подборки, их заказы).
  for (const [inn, legalName] of [[DEMO_INN, 'ООО «МедТекс» (демо)'], [DEMO_INN_2, 'ООО «Форма+» (демо)']]) {
    const old = await prisma.supplier.findFirst({
      where: { inn, legalName },
      include: { products: { select: { id: true } }, articles: { select: { coverKey: true } }, collections: { select: { coverKey: true } } },
    });
    if (old) {
      for (const p of old.products) await rm(resolve(ROOT, 'public/products', p.id), { recursive: true, force: true });
      for (const c of [...old.articles, ...old.collections]) if (c.coverKey) await rm(resolve(ROOT, c.coverKey), { force: true });
      await prisma.order.deleteMany({ where: { shipments: { some: { supplierId: old.id } } } });
      await prisma.product.deleteMany({ where: { supplierId: old.id } });
      await prisma.supplier.delete({ where: { id: old.id } });
    }
    if (await prisma.supplier.findUnique({ where: { inn } })) {
      console.error(`ИНН ${inn} уже занят не демо-поставщиком — демо не создаю.`);
      process.exit(1);
    }
  }
  // Материалы редакции (без поставщика) удаляем по слагам
  for (const a of await prisma.article.findMany({ where: { supplierId: null, slug: { in: EDITORIAL_SLUGS } } })) {
    if (a.coverKey) await rm(resolve(ROOT, a.coverKey), { force: true });
    await prisma.article.delete({ where: { id: a.id } });
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
    if (!category || !color) throw new Error(`Нет категории ${item.category} или цвета ${item.color} — сначала pnpm db:seed`);
    const second = colors.find((c) => c.name === (item.second ?? (color.name === 'Белый' ? 'Графит' : 'Белый')))!;
    const p = await prisma.product.create({
      data: {
        supplierId: SPB_BRANDS.includes(item.brand) ? supplierSpb.id : supplier.id, brandId: brand.id, categoryId: category.id, title: item.title, slug: `${slug(item.title)}-${n + 1}`,
        gender: item.gender, fabric: item.fabric ?? '65% ПЭ · 35% хлопок', treatment: 'Антибактериальная', washing: 'до 60° · 600+ циклов',
        description:
          item.category === 'kroksy' || item.category === 'aksessuary'
            ? `${item.title} — лёгкая и прочная вещь для долгой смены: легко моется, не скользит и дополняет капсулу.`
            : `${item.title} — эластичная медицинская одежда для активного рабочего дня. Мягкая ткань сохраняет аккуратную посадку и легко комбинируется с другими вещами капсулы.`,
        moderationStatus: 'published', publishedAt: new Date(Date.now() - n * 3600_000), source: 'manual', premium: item.premium ?? false,
        specialties: { create: specialties.filter((s) => item.specialties.includes(s.name)).map((s) => ({ specialtyId: s.id })) },
      },
    });
    const heights = item.heights ?? [null];
    let i = 0;
    const palette = item.colors ? item.colors.map((name) => colorHex.get(name)!) : item.oneColor ? [color] : [color, second];
    for (const c of palette) {
      for (const size of item.sizes)
        for (const h of heights) {
          await prisma.productVariant.create({
            data: {
              productId: p.id, sku: `DM-${n + 1}-${String(i).padStart(2, '0')}-${size}`, size, heightRange: h, colorId: c.id,
              price: item.price * 100, oldPrice: item.oldPrice ? item.oldPrice * 100 : null, stock: 2 + ((i * 7 + 3) % 11), weightG: 600, lengthMm: 300, widthMm: 250, heightMm: 50,
            },
          });
          i += 1;
        }
    }
    // Фото привязаны к цвету со снимка (ТЗ §4.3); у второго цвета своих снимков нет — витрина покажет эти же
    const shots = await Promise.all(item.photos.map((shot, a) => photo(p.id, shot, a, item.oneColor ? null : color.id)));
    await prisma.productMedia.createMany({ data: shots });
    created.push({ id: p.id, item });
  }

  const pick = (pred: (i: Item) => boolean) => created.filter((c) => pred(c.item)).map((c) => c.id);
  const byTitles = (titles: string[]) => titles.map((t) => created.find((c) => c.item.title === t)!.id);
  /** Статьи и подборки кадра .Articles: свежие сверху, поэтому дата публикации задаёт порядок ленты (шаг — минута). */
  const at = (n: number) => new Date(Date.now() - n * 60_000);
  const article = (supplierId: string | null, title: string, lead: string, body: string, coverFile: string, productIds: string[], n: number) =>
    cover(coverFile).then((coverKey) =>
      prisma.article.create({
        data: { supplierId, slug: `${slug(title)}-demo`, title, lead, coverKey, body, status: 'published', publishedAt: at(n), products: { create: productIds.map((productId, position) => ({ productId, position })) } },
      }),
    );
  await article(
    supplier.id,
    'Как выбрать форму для долгой смены',
    'Практические советы о посадке, ткани и рабочем ритме.',
    '<p>Ткань, обработка, режим стирки, крой и карманы — разбираем, на что смотреть при выборе костюма для смены. Смесовая ткань 65/35 с антибактериальной пропиткой выдерживает 600+ циклов стирки при 60° — это ключевое требование операционной.</p><h2>Посадка</h2><p>Свободный крой не сковывает движения, а эластан в брюках сохраняет форму к концу смены.</p><ul><li>Проверьте глубину карманов под телефон и ручки.</li><li>Выбирайте ростовку, а не только размер.</li></ul>',
    'statya-dolgaya-smena', byTitles(['Костюм «Хирург»', 'Брюки «Хирург»']), 0,
  );
  // Подборка кадра .Articles-Selection: шесть вещей поставщика «Форма+» и партнёров
  await prisma.collection.create({
    data: {
      supplierId: supplierSpb.id, slug: 'podborka-forma-dlya-stomatologii-demo', title: 'Подборка: форма для стоматологии', description: 'Собранный комплект для спокойной рабочей смены.',
      coverKey: await cover('podborka-stomatologiya'), status: 'published', publishedAt: at(1),
      products: {
        create: byTitles(['Костюм «Стоматолог»', 'Брюки «Базис»', 'Халат женский «Классика»', 'Халат «Доктор»', 'Костюм «Премиум»', 'Блуза «Комфорт»']).map((productId, position) => ({ productId, position })),
      },
    },
  });
  // Материал редакции: автор — платформа
  await article(
    null,
    'Уход за формой: стирка при 60°',
    'Как сохранить цвет и посадку после сотен стирок.',
    '<p>Медицинская одежда стирается чаще обычной — правильный режим продлевает её жизнь вдвое.</p><h2>Температура</h2><p>60° убивают большинство бактерий и не разрушают смесовые ткани. Белый халат можно стирать при 90°, если позволяет ярлык.</p><h2>Сушка</h2><p>Сушите на плечиках — так меньше гладить.</p>',
    'statya-uhod-stirka', pick((i) => i.category === 'halaty'), 2,
  );
  // В макете у двух следующих карточек заголовок первой статьи (ТЗ §12 п.16) — здесь у каждой свой
  await article(
    supplier.id,
    'Форма для ночного дежурства',
    'Мягкая ткань и свободный крой для суточной смены.',
    '<p>На суточном дежурстве форма должна быть удобной не только на ногах, но и в кресле ординаторской.</p><h2>Ткань</h2><p>Микрофибра и смесовые ткани с вискозой мягче хлопка и меньше мнутся, когда вы отдыхаете между вызовами.</p><h2>Крой</h2><p>Брюки с эластичным поясом и манжетами не давят и не задираются, а топ свободного кроя не стесняет плечи.</p>',
    'statya-dezhurstvo', byTitles(['Костюм «Премиум»', 'Брюки джоггеры']), 3,
  );
  await article(
    supplier.id,
    'Зачем медицинской форме эластан',
    'Как стрейч держит посадку к концу смены.',
    '<p>Несколько процентов эластана делают ткань упругой: она тянется при наклоне и возвращается обратно.</p><h2>Сколько нужно</h2><p>Для брюк и топов достаточно 3–5% эластана — больше снижает стойкость к стирке при 60°.</p><h2>Как проверить</h2><p>Растяните ткань на пояснице: хорошая смесовая ткань сразу возвращает форму, без вытянутых пузырей.</p>',
    'statya-elastan', byTitles(['Брюки «Актив»', 'Топ «Актив»']), 4,
  );
  // Подборка из блока «В подборках» кадра .Product card
  await prisma.collection.create({
    data: {
      supplierId: supplier.id, slug: 'grafitovaya-rabochaya-baza-demo', title: 'Графитовая рабочая база', description: 'Спокойные оттенки и практичные вещи для каждой смены.',
      coverKey: await cover('podborka-grafit'), status: 'published', publishedAt: at(5),
      products: { create: pick((i) => ['Костюм «Хирург»', 'Брюки «Хирург»', 'Костюм «Базис»', 'Брюки «Базис»'].includes(i.title)).map((productId, position) => ({ productId, position })) },
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
  // В акции — вещи вне сетки макета, чтобы цены и плашки каталога совпадали с макетом
  const surgical = await prisma.product.findMany({ where: { id: { in: pick((i) => !!i.promo) } } });
  for (const p of surgical) {
    await prisma.promotionProduct.create({ data: { promotionId: running.id, productId: p.id, supplierId: p.supplierId, discountPct: 20, status: 'approved', decidedAt: new Date() } });
  }
  await repriceSales(prisma);

  // Демо-админ для dev-стенда (пароль тот же DEMO_PASSWORD).
  await prisma.user.upsert({ where: { email: 'demo.admin@example.ru' }, update: { passwordHash }, create: { email: 'demo.admin@example.ru', role: 'admin', passwordHash, emailVerifiedAt: new Date() } });

  console.log(`Демо: ${created.length} товаров (премиум: ${created.filter((c) => c.item.premium).length}), 4 статьи, 2 подборки. Поставщики «${supplier.legalName}» и «${supplierSpb.legalName}».`);
}

main().finally(() => prisma.$disconnect());
