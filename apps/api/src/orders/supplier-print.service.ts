import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatRub } from '@aesculap/shared';
import type { Supplier, User } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PdfDoc } from '../common/pdf';
import { PrismaService } from '../common/prisma.service';
import { cdekPrintMany } from '../delivery/cdek-print';
import { DeliveryService, parcelOf } from '../delivery/delivery.service';

export const MAX_PRINT = 100;
const dateRu = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
const plural = (n: number, forms: [string, string, string]) => forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
const stamp = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');

/**
 * Массовая печать в списке заказов поставщика: накладные или этикетки СДЭК одним PDF и акт приёма-передачи
 * для курьера СДЭК. Только свои отправления и только с созданной накладной СДЭК.
 */
@Injectable()
export class SupplierPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly audit: AuditService,
  ) {}

  private async load(supplier: Supplier, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException({ message: 'Выберите отправления' });
    if (unique.length > MAX_PRINT) throw new BadRequestException({ message: `Не больше ${MAX_PRINT} отправлений за раз` });
    const rows = await this.prisma.shipment.findMany({
      where: { id: { in: unique }, supplierId: supplier.id, status: { not: 'awaiting_payment' } },
      include: { items: true, order: { select: { number: true, recipientName: true } } },
    });
    // Чужое или несуществующее отправление — как в карточке, 404 (без подсказки, что оно есть у другого поставщика)
    if (rows.length !== unique.length) throw new NotFoundException({ message: 'Отправление не найдено' });
    const order = new Map(unique.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const noWaybill = rows.filter((s) => !s.cdekUuid);
    if (noWaybill.length) {
      throw new BadRequestException({
        message: `Нет накладной СДЭК: ${noWaybill.map((s) => `${s.order.number}-${s.no}`).join(', ')}. Сначала нажмите «Накладная СДЭК» у этих отправлений.`,
      });
    }
    return rows;
  }

  /** Накладные (waybill) или этикетки (barcode) одним PDF */
  async waybills(supplier: Supplier, ids: string[], kind: 'waybill' | 'barcode', actor: User) {
    const rows = await this.load(supplier, ids);
    let pdf: Buffer;
    if (this.delivery.provider.name === 'cdek') pdf = await cdekPrintMany(rows.map((s) => s.cdekUuid!), kind);
    else {
      // Офлайн-драйвер: заглушка — по странице на отправление, как одиночная тестовая накладная
      const doc = new PdfDoc(kind === 'waybill' ? 'Накладные СДЭК (тест)' : 'Этикетки СДЭК (тест)');
      for (const s of rows) {
        doc.addPage();
        doc.text(40, 40, `${kind === 'waybill' ? 'Накладная' : 'Этикетка'} СДЭК — тестовый режим`, { size: 18, bold: true });
        doc.text(40, 72, `Отправление ${s.order.number}-${s.no} · трек ${s.trackNo ?? '—'}`, { size: 12 });
        doc.text(40, 92, `Получатель: ${s.order.recipientName} · ${s.address}`, { size: 11 });
        doc.text(40, 112, `Отправитель: ${supplier.legalName}, ИНН ${supplier.inn}`, { size: 11 });
        doc.text(40, 140, 'Это заглушка DELIVERY_DRIVER=fake: настоящий PDF формирует СДЭК.', { size: 9, color: [0.4, 0.4, 0.4] });
      }
      pdf = doc.toBuffer();
    }
    await this.audit.log(actor.id, kind === 'waybill' ? 'shipment.print_waybills' : 'shipment.print_labels', 'supplier', supplier.id, { shipments: rows.map((s) => s.id) });
    return { pdf, name: `${kind === 'waybill' ? 'nakladnye' : 'etiketki'}-${stamp(new Date())}-${rows.length}.pdf` };
  }

  /** Акт приёма-передачи отправлений курьеру СДЭК */
  async act(supplier: Supplier, ids: string[], actor: User, now = new Date()) {
    const rows = await this.load(supplier, ids);
    const doc = new PdfDoc(`Акт приёма-передачи отправлений от ${dateRu(now)}`);
    const M = 40;
    const W = doc.width - M * 2;
    // Колонки: №, отправление, трек, куда, мест, вес, ценность
    const cols = [
      { title: '№', w: 24, align: 'center' as const },
      { title: 'Отправление', w: 78 },
      { title: 'Трек-номер СДЭК', w: 96 },
      { title: 'Получатель, куда', w: W - 24 - 78 - 96 - 36 - 50 - 78 },
      { title: 'Мест', w: 36, align: 'center' as const },
      { title: 'Вес, кг', w: 50, align: 'right' as const },
      { title: 'Ценность, ₽', w: 78, align: 'right' as const },
    ];
    const header = (y: number) => {
      doc.rect(M, y, W, 20, { fill: 0.93 });
      let x = M;
      for (const c of cols) {
        doc.text(x + 4, y + 5, c.title, { size: 8.5, bold: true, align: c.align, width: c.w - 8 });
        x += c.w;
      }
      return y + 20;
    };

    doc.addPage();
    doc.text(M, 40, 'Акт приёма-передачи отправлений', { size: 18, bold: true });
    doc.text(M, 64, `от ${dateRu(now)} · ${rows.length} ${plural(rows.length, ['отправление', 'отправления', 'отправлений'])}`, { size: 11 });
    let y = 92;
    const info: [string, string][] = [
      ['Отправитель', `${supplier.legalName}, ИНН ${supplier.inn}${supplier.kpp ? `, КПП ${supplier.kpp}` : ''}`],
      ['Адрес отгрузки', supplier.warehouseAddress || '—'],
      ['Пункт сдачи СДЭК', supplier.cdekShipmentPoint || 'забор курьером'],
      ['Контакт', [supplier.contactName, supplier.contactPhone].filter(Boolean).join(', ') || '—'],
      ['Перевозчик', 'СДЭК'],
    ];
    for (const [k, v] of info) {
      doc.text(M, y, `${k}:`, { size: 10, bold: true });
      const lines = doc.wrap(v, W - 120, 10);
      lines.forEach((l, i) => doc.text(M + 120, y + i * 13, l, { size: 10 }));
      y += Math.max(1, lines.length) * 13 + 2;
    }
    y = header(y + 10);

    let places = 0;
    let weightG = 0;
    let value = 0;
    rows.forEach((s, n) => {
      const parcel = parcelOf(s.items.map((i) => ({ qty: i.qty, weightG: i.weightG })));
      // Отправление — одна посылка (parcelOf собирает товары в одну коробку)
      const place = 1;
      places += place;
      weightG += parcel.weightG;
      value += s.goodsTotal;
      const dest = doc.wrap(`${s.order.recipientName}; ${s.deliveryType === 'pvz' ? 'ПВЗ' : 'курьер'}: ${s.address}`, cols[3].w - 8, 8.5);
      const h = Math.max(18, dest.length * 11 + 7);
      if (y + h > doc.height - 60) {
        doc.addPage();
        y = header(40);
      }
      const cells = [String(n + 1), `${s.order.number}-${s.no}`, s.trackNo ?? 'ожидается', '', String(place), (parcel.weightG / 1000).toFixed(2).replace('.', ','), formatRub(s.goodsTotal).replace(/\s?₽$/, '')];
      let x = M;
      cols.forEach((c, i) => {
        if (i === 3) dest.forEach((l, k) => doc.text(x + 4, y + 5 + k * 11, l, { size: 8.5 }));
        else doc.text(x + 4, y + 5, cells[i], { size: 8.5, align: c.align, width: c.w - 8 });
        x += c.w;
      });
      doc.line(M, y + h, M + W, y + h, 0.4, 0.6);
      y += h;
    });
    // Итого и подписи
    if (y + 190 > doc.height - 40) {
      doc.addPage();
      y = 40;
    }
    doc.rect(M, y, W, 20, { fill: 0.96 });
    doc.text(M + 4, y + 5, `Итого: отправлений ${rows.length}, мест ${places}, вес ${(weightG / 1000).toFixed(2).replace('.', ',')} кг, объявленная ценность ${formatRub(value)}`, { size: 9, bold: true });
    y += 34;
    for (const l of doc.wrap('Отправления переданы в упаковке без видимых повреждений, количество мест сверено с актом. Претензии по количеству мест принимаются при подписании акта.', W, 9)) {
      doc.text(M, y, l, { size: 9, color: [0.25, 0.25, 0.25] });
      y += 12;
    }
    y += 24;
    const half = (W - 30) / 2;
    for (const [i, who] of ['Сдал (отправитель)', 'Принял (курьер СДЭК)'].entries()) {
      const x = M + i * (half + 30);
      doc.text(x, y, who, { size: 10, bold: true });
      doc.line(x, y + 40, x + half, y + 40, 0.6);
      doc.text(x, y + 44, 'подпись / расшифровка', { size: 8, color: [0.4, 0.4, 0.4] });
      doc.line(x, y + 80, x + half, y + 80, 0.6);
      doc.text(x, y + 84, 'дата и время передачи', { size: 8, color: [0.4, 0.4, 0.4] });
    }
    doc.text(M, y + 104, 'М. П.', { size: 9, color: [0.4, 0.4, 0.4] });

    await this.audit.log(actor.id, 'shipment.print_act', 'supplier', supplier.id, { shipments: rows.map((s) => s.id) });
    return { pdf: doc.toBuffer(), name: `akt-sdek-${stamp(now)}-${rows.length}.pdf` };
  }
}
