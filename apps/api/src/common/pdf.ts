import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

/**
 * Небольшой генератор PDF без зависимостей: страницы A4, текст со встроенным TrueType-шрифтом (PT Sans,
 * кириллица — через Identity-H и ToUnicode, текст копируется и ищется), линии и прямоугольники.
 * Используется для акта приёма-передачи СДЭК и заглушек накладных в офлайн-режиме доставки.
 * Координаты — от левого верхнего угла страницы, в пунктах (1/72 дюйма).
 */

export const A4 = { width: 595.28, height: 841.89 };

type FontKind = 'regular' | 'bold';

type TtfFont = {
  name: string;
  data: Buffer;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  /** Unicode → номер глифа */
  cmap: Map<number, number>;
  /** Ширина глифа в единицах шрифта */
  advance: (gid: number) => number;
};

const FONT_FILES: Record<FontKind, [string, string]> = { regular: ['PTSans-Regular', 'PTSans-Regular.ttf'], bold: ['PTSans-Bold', 'PTSans-Bold.ttf'] };

/** Папка со шрифтами: apps/api/assets/fonts (dev, тесты, сборка dist/ и образ /app). */
function fontDir(): string {
  const candidates = [join(__dirname, '..', '..', 'assets', 'fonts'), join(__dirname, '..', '..', '..', 'assets', 'fonts'), join(process.cwd(), 'assets', 'fonts'), join(process.cwd(), 'apps', 'api', 'assets', 'fonts')];
  const found = candidates.find((d) => existsSync(join(d, FONT_FILES.regular[1])));
  if (!found) throw new Error('Не найдены шрифты для PDF (apps/api/assets/fonts)');
  return found;
}

function parseTtf(name: string, data: Buffer): TtfFont {
  const tables = new Map<string, number>();
  const numTables = data.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    tables.set(data.toString('latin1', r, r + 4), data.readUInt32BE(r + 8));
  }
  const t = (tag: string) => {
    const off = tables.get(tag);
    if (off === undefined) throw new Error(`В шрифте ${name} нет таблицы ${tag}`);
    return off;
  };
  const head = t('head');
  const hhea = t('hhea');
  const hmtx = t('hmtx');
  const unitsPerEm = data.readUInt16BE(head + 18);
  const bbox: [number, number, number, number] = [data.readInt16BE(head + 36), data.readInt16BE(head + 38), data.readInt16BE(head + 40), data.readInt16BE(head + 42)];
  const ascent = data.readInt16BE(hhea + 4);
  const descent = data.readInt16BE(hhea + 6);
  const numberOfHMetrics = data.readUInt16BE(hhea + 34);
  const os2 = tables.get('OS/2');
  const capHeight = os2 !== undefined && data.readUInt16BE(os2) >= 2 ? data.readInt16BE(os2 + 88) : ascent;
  const advance = (gid: number) => data.readUInt16BE(hmtx + Math.min(gid, numberOfHMetrics - 1) * 4);

  // cmap: Unicode BMP формата 4 — Windows (3,1) или Unicode (0,*)
  const cmapOff = t('cmap');
  const cmap = new Map<number, number>();
  const n = data.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < n; i++) {
    const r = cmapOff + 4 + i * 8;
    const platform = data.readUInt16BE(r);
    if (!(platform === 0 || (platform === 3 && data.readUInt16BE(r + 2) === 1))) continue;
    const sub = cmapOff + data.readUInt32BE(r + 4);
    if (data.readUInt16BE(sub) !== 4) continue;
    const segX2 = data.readUInt16BE(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = data.readUInt16BE(ends + s * 2);
      const start = data.readUInt16BE(starts + s * 2);
      const delta = data.readInt16BE(deltas + s * 2);
      const rangeOffPos = ranges + s * 2;
      const rangeOff = data.readUInt16BE(rangeOffPos);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (rangeOff === 0) gid = (c + delta) & 0xffff;
        else {
          const g = data.readUInt16BE(rangeOffPos + rangeOff + (c - start) * 2);
          gid = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (gid) cmap.set(c, gid);
      }
    }
    break;
  }
  return { name, data, unitsPerEm, ascent, descent, capHeight, bbox, cmap, advance };
}

let fonts: Record<FontKind, TtfFont> | null = null;
function loadFonts() {
  if (!fonts) {
    const dir = fontDir();
    fonts = {
      regular: parseTtf(FONT_FILES.regular[0], readFileSync(join(dir, FONT_FILES.regular[1]))),
      bold: parseTtf(FONT_FILES.bold[0], readFileSync(join(dir, FONT_FILES.bold[1]))),
    };
  }
  return fonts;
}

/** Строка PDF в UTF-16BE (для словаря Info) */
const pdfText = (s: string) => `<FEFF${[...s].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`;
const num = (n: number) => (Math.round(n * 100) / 100).toString();
const hex4 = (n: number) => n.toString(16).padStart(4, '0');

export type TextOpts = { size?: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right' | 'center'; width?: number };

export class PdfDoc {
  private readonly pages: string[][] = [];
  private readonly used: Record<FontKind, Map<number, number>> = { regular: new Map(), bold: new Map() };
  private readonly f = loadFonts();
  readonly width = A4.width;
  readonly height = A4.height;

  constructor(private readonly title = '') {}

  get pageCount() {
    return this.pages.length;
  }

  addPage() {
    this.pages.push([]);
    return this;
  }

  private get ops() {
    if (!this.pages.length) this.addPage();
    return this.pages[this.pages.length - 1];
  }

  /** Номера глифов строки; символов, которых нет в шрифте, — «?» */
  private glyphs(text: string, kind: FontKind) {
    const font = this.f[kind];
    const q = font.cmap.get(0x3f) ?? 0;
    return [...text.replace(/[\r\n\t]+/g, ' ')].map((ch) => {
      const cp = ch.codePointAt(0)!;
      const gid = font.cmap.get(cp);
      return gid ? { gid, cp } : { gid: q, cp: 0x3f };
    });
  }

  textWidth(text: string, size = 10, bold = false) {
    const kind: FontKind = bold ? 'bold' : 'regular';
    const font = this.f[kind];
    return this.glyphs(text, kind).reduce((s, g) => s + font.advance(g.gid), 0) * (size / font.unitsPerEm);
  }

  /** Текст: y — верх строки. align/width — выравнивание в колонке шириной width. */
  text(x: number, y: number, text: string, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const kind: FontKind = o.bold ? 'bold' : 'regular';
    const font = this.f[kind];
    const gl = this.glyphs(text, kind);
    for (const g of gl) this.used[kind].set(g.gid, g.cp);
    let left = x;
    if (o.width !== undefined && o.align && o.align !== 'left') {
      const w = this.textWidth(text, size, o.bold);
      left = o.align === 'right' ? x + o.width - w : x + (o.width - w) / 2;
    }
    const baseline = this.height - y - (font.ascent / font.unitsPerEm) * size;
    const [r, g, b] = o.color ?? [0, 0, 0];
    this.ops.push(`BT ${num(r)} ${num(g)} ${num(b)} rg /${kind === 'bold' ? 'F2' : 'F1'} ${num(size)} Tf ${num(left)} ${num(baseline)} Td <${gl.map((x) => hex4(x.gid)).join('')}> Tj ET`);
    return this;
  }

  /** Перенос по словам в пределах ширины */
  wrap(text: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.textWidth(next, size, bold) <= maxWidth || !line) {
          // Слово длиннее строки режем по символам
          if (!line && this.textWidth(word, size, bold) > maxWidth) {
            let chunk = '';
            for (const ch of word) {
              if (this.textWidth(chunk + ch, size, bold) > maxWidth && chunk) {
                lines.push(chunk);
                chunk = '';
              }
              chunk += ch;
            }
            line = chunk;
          } else line = next;
        } else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0) {
    this.ops.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, o: { fill?: number; stroke?: number; width?: number } = {}) {
    const box = `${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re`;
    if (o.fill !== undefined) this.ops.push(`${num(o.fill)} g ${box} f`);
    if (o.stroke !== undefined) this.ops.push(`${num(o.stroke)} G ${num(o.width ?? 0.5)} w ${box} S`);
    return this;
  }

  toBuffer(): Buffer {
    if (!this.pages.length) this.addPage();
    const objs: (string | Buffer)[] = [];
    const add = (o: string | Buffer) => objs.push(o) as number;
    const stream = (dict: string, body: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream', 'latin1')]);

    const catalog = add('');
    const pagesObj = add('');
    const fontRefs: Partial<Record<FontKind, number>> = {};
    for (const kind of ['regular', 'bold'] as FontKind[]) {
      const used = this.used[kind];
      if (!used.size) continue;
      const font = this.f[kind];
      const k = 1000 / font.unitsPerEm;
      const file = add(stream(`/Filter /FlateDecode /Length1 ${font.data.length}`, deflateSync(font.data)));
      const desc = add(
        `<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 /FontBBox [${font.bbox.map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle 0 ` +
          `/Ascent ${Math.round(font.ascent * k)} /Descent ${Math.round(font.descent * k)} /CapHeight ${Math.round(font.capHeight * k)} /StemV ${kind === 'bold' ? 120 : 80} /FontFile2 ${file} 0 R >>`,
      );
      const gids = [...used.keys()].sort((a, b) => a - b);
      const widths = gids.map((g) => `${g} [${Math.round(font.advance(g) * k)}]`).join(' ');
      const cid = add(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 500 /W [${widths}] >>`,
      );
      // ToUnicode: текст из PDF копируется и находится поиском
      const bf: string[] = [];
      for (let i = 0; i < gids.length; i += 100) {
        const chunk = gids.slice(i, i + 100);
        bf.push(`${chunk.length} beginbfchar\n${chunk.map((g) => `<${hex4(g)}> <${hex4(used.get(g)!)}>`).join('\n')}\nendbfchar`);
      }
      const cmap = [
        '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def',
        '1 begincodespacerange <0000> <FFFF> endcodespacerange',
        ...bf,
        'endcmap CMapName currentdict /CMap defineresource pop end end',
      ].join('\n');
      const tu = add(stream('/Filter /FlateDecode', deflateSync(Buffer.from(cmap, 'latin1'))));
      fontRefs[kind] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${font.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    }
    const fontDict = `<< ${fontRefs.regular ? `/F1 ${fontRefs.regular} 0 R ` : ''}${fontRefs.bold ? `/F2 ${fontRefs.bold} 0 R` : ''} >>`;
    const kids: number[] = [];
    for (const ops of this.pages) {
      const content = add(stream('/Filter /FlateDecode', deflateSync(Buffer.from(ops.join('\n'), 'latin1'))));
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] /Contents ${content} 0 R /Resources << /Font ${fontDict} >> >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /Lang ${pdfText('ru-RU')} >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${pdfText(this.title)} /Producer (aesculap) >>`);

    const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let length = chunks[0].length;
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(length);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof o === 'string' ? Buffer.from(o, 'latin1') : o, Buffer.from('\nendobj\n', 'latin1')]);
      chunks.push(b);
      length += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

/** Число страниц готового PDF (для тестов и проверок) */
export const pdfPageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
