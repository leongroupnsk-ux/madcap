import { parse as parseCsvSync } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';

/** Каноническая строка импорта: одна строка = один вариант (SKU) товара. */
export type RawRow = Partial<Record<ColumnKey, string>> & { __row: number };

export const COLUMNS = [
  { key: 'external_id', label: 'Артикул модели', hint: 'Общий для всех размеров и цветов одной модели', required: true },
  { key: 'title', label: 'Название', hint: 'Без размера и цвета', required: true },
  { key: 'brand', label: 'Бренд', hint: 'Новый бренд будет создан', required: true },
  { key: 'category', label: 'Категория', hint: 'Как на сайте: Костюмы, Халаты, Топы, Брюки, Обувь…', required: true },
  { key: 'gender', label: 'Пол', hint: 'Женский / Мужской / Унисекс', required: false },
  { key: 'fabric', label: 'Состав ткани', hint: 'Например: 65% ПЭ · 35% хлопок', required: false },
  { key: 'treatment', label: 'Обработка', hint: 'Например: антибактериальная', required: false },
  { key: 'washing', label: 'Стирка', hint: 'Например: до 60° · 600+ циклов', required: false },
  { key: 'description', label: 'Описание', hint: '', required: false },
  { key: 'specialties', label: 'Специальности', hint: 'Через запятую: Хирург, Стоматолог-терапевт', required: false },
  { key: 'sku', label: 'SKU', hint: 'Уникальный код варианта', required: true },
  { key: 'size', label: 'Размер', hint: 'XS, S, M, L, XL, XXL или 38, 39…', required: true },
  { key: 'height_range', label: 'Ростовка', hint: 'Например: 170–176', required: false },
  { key: 'color', label: 'Цвет', hint: 'Из справочника: Белый, Графит, Бирюзовый…', required: true },
  { key: 'price', label: 'Цена, ₽', hint: '', required: true },
  { key: 'old_price', label: 'Старая цена, ₽', hint: 'Если есть скидка', required: false },
  { key: 'stock', label: 'Остаток, шт', hint: '', required: true },
  { key: 'weight_g', label: 'Вес, г', hint: 'Для СДЭК', required: true },
  { key: 'length_mm', label: 'Длина, мм', hint: 'Упаковка', required: true },
  { key: 'width_mm', label: 'Ширина, мм', hint: 'Упаковка', required: true },
  { key: 'height_mm', label: 'Высота, мм', hint: 'Упаковка', required: true },
  { key: 'photos', label: 'Фото (ссылки через |)', hint: 'Минимум 3, первое — главное', required: false },
] as const;
export type ColumnKey = (typeof COLUMNS)[number]['key'];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
const HEADER_MAP = new Map<string, ColumnKey>();
for (const c of COLUMNS) {
  HEADER_MAP.set(norm(c.key), c.key);
  HEADER_MAP.set(norm(c.label), c.key);
}
// Распространённые варианты заголовков
for (const [alias, key] of [
  ['артикул', 'external_id'], ['модель', 'external_id'], ['наименование', 'title'], ['производитель', 'brand'],
  ['цена', 'price'], ['старая цена', 'old_price'], ['остаток', 'stock'], ['количество', 'stock'], ['вес', 'weight_g'],
  ['рост', 'height_range'], ['фото', 'photos'], ['изображения', 'photos'], ['состав', 'fabric'],
] as const) HEADER_MAP.set(norm(alias), key);

export class ParseError extends Error {}

function mapRows(table: string[][]): RawRow[] {
  const headerIdx = table.findIndex((r) => r.some((c) => HEADER_MAP.has(norm(c))));
  if (headerIdx < 0) throw new ParseError('Не нашли строку заголовков. Скачайте шаблон и заполните его.');
  const header = table[headerIdx].map((c) => HEADER_MAP.get(norm(c)) ?? null);
  const missing = COLUMNS.filter((c) => c.required && !header.includes(c.key)).map((c) => c.label);
  if (missing.length) throw new ParseError(`В файле нет обязательных колонок: ${missing.join(', ')}`);
  const rows: RawRow[] = [];
  table.slice(headerIdx + 1).forEach((cells, i) => {
    if (cells.every((c) => !c?.trim())) return;
    const row: RawRow = { __row: headerIdx + i + 2 };
    header.forEach((key, col) => {
      if (key) row[key] = (cells[col] ?? '').trim();
    });
    rows.push(row);
  });
  return rows;
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return String(v.result ?? '');
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
};

export async function parseXlsx(buffer: Buffer): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ParseError('Не удалось прочитать XLSX. Сохраните файл в Excel как «Книга Excel (.xlsx)».');
  }
  const ws = wb.worksheets.find((w) => w.name === 'Товары') ?? wb.worksheets[0];
  if (!ws) throw new ParseError('В файле нет листов');
  const table: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellText(row.getCell(c).value));
    table.push(cells);
  });
  return mapRows(table);
}

export function parseCsv(buffer: Buffer): RawRow[] {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  try {
    const table = parseCsvSync(text, { delimiter, relax_column_count: true, skip_empty_lines: false }) as string[][];
    return mapRows(table);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError('Не удалось прочитать CSV: проверьте кодировку (UTF-8) и разделитель (; или ,)');
  }
}

/** Яндекс YML: offer → вариант, group_id (или vendorCode) → модель (ТЗ §10). */
export function parseYml(xml: string): RawRow[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, isArray: (name) => ['offer', 'category', 'param', 'picture'].includes(name) });
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new ParseError('Фид не является корректным XML');
  }
  const shop = doc?.yml_catalog?.shop;
  if (!shop) throw new ParseError('Это не YML-фид: нет yml_catalog/shop');
  const catNames = new Map<string, string>();
  for (const c of shop.categories?.category ?? []) catNames.set(String(c['@_id']), String(c['#text'] ?? '').trim());
  const text = (v: unknown) => (v == null ? '' : typeof v === 'object' ? String((v as any)['#text'] ?? '') : String(v)).trim();

  return (shop.offers?.offer ?? []).map((o: any, i: number): RawRow => {
    const params = new Map<string, string>();
    for (const p of o.param ?? []) params.set(norm(String(p['@_name'] ?? '')), text(p));
    const dims = text(o.dimensions).split('/').map((n) => Math.round(Number(n.replace(',', '.')) * 10));
    const weightKg = Number(text(o.weight).replace(',', '.'));
    const available = String(o['@_available'] ?? 'true') !== 'false';
    const count = text(o.count) || text(o.quantity) || text(o.stock);
    return {
      __row: i + 1,
      external_id: text(o['@_group_id']) || text(o.vendorCode) || text(o['@_id']),
      title: text(o.model) || text(o.name),
      brand: text(o.vendor),
      category: catNames.get(text(o.categoryId)) ?? '',
      gender: params.get(norm('Пол')) ?? '',
      fabric: params.get(norm('Состав')) ?? params.get(norm('Материал')) ?? '',
      treatment: params.get(norm('Обработка')) ?? '',
      washing: params.get(norm('Стирка')) ?? params.get(norm('Уход')) ?? '',
      description: text(o.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      specialties: params.get(norm('Специальность')) ?? params.get(norm('Специальности')) ?? '',
      sku: text(o['@_id']),
      size: params.get(norm('Размер')) ?? '',
      height_range: params.get(norm('Рост')) ?? params.get(norm('Ростовка')) ?? '',
      color: params.get(norm('Цвет')) ?? '',
      price: text(o.price),
      old_price: text(o.oldprice),
      stock: !available ? '0' : count,
      weight_g: Number.isFinite(weightKg) && weightKg > 0 ? String(Math.round(weightKg * 1000)) : '',
      length_mm: dims.length === 3 && dims.every((d) => d > 0) ? String(dims[0]) : '',
      width_mm: dims.length === 3 && dims.every((d) => d > 0) ? String(dims[1]) : '',
      height_mm: dims.length === 3 && dims.every((d) => d > 0) ? String(dims[2]) : '',
      photos: (o.picture ?? []).map(text).filter(Boolean).join('|'),
    };
  });
}

/** Шаблон XLSX: лист «Товары» с примером и лист «Инструкция». */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Товары');
  ws.columns = COLUMNS.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3ECE7' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const example = {
    external_id: 'MT-1101', title: 'Костюм «Хирург»', brand: 'МедТекс', category: 'Костюмы', gender: 'Унисекс',
    fabric: '65% ПЭ · 35% хлопок', treatment: 'Антибактериальная', washing: 'до 60° · 600+ циклов',
    description: 'Классический скраб-костюм для операционной и приёма.', specialties: 'Хирург, Стоматолог-хирург',
    price: 4590, old_price: 5290, stock: 12, weight_g: 600, length_mm: 300, width_mm: 250, height_mm: 50,
    photos: 'https://example.ru/1.jpg|https://example.ru/2.jpg|https://example.ru/3.jpg',
  };
  ws.addRow({ ...example, sku: 'MT-1101-TL-M', size: 'M', height_range: '170–176', color: 'Бирюзовый' });
  ws.addRow({ ...example, sku: 'MT-1101-TL-L', size: 'L', height_range: '170–176', color: 'Бирюзовый', stock: 7 });

  const help = wb.addWorksheet('Инструкция');
  help.columns = [{ header: 'Колонка', width: 26 }, { header: 'Обязательна', width: 14 }, { header: 'Как заполнять', width: 70 }];
  help.getRow(1).font = { bold: true };
  for (const c of COLUMNS) help.addRow([c.label, c.required ? 'да' : '', c.hint]);
  help.addRow([]);
  help.addRow(['Одна строка — один вариант (размер × цвет). Строки одной модели объединяются по «Артикул модели».']);
  help.addRow(['Новые товары уходят на модерацию; у существующих цены и остатки обновляются сразу.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
