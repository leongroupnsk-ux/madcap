import { randomUUID } from 'node:crypto';
import type { ShipmentStatus } from '@prisma/client';
import type { City, CreateDeliveryOrder, DeliveryOrderState, DeliveryProvider, Parcel, Point, Quote } from './delivery.provider';

const CITIES: (City & { lat: number; lon: number; zone: number })[] = [
  { code: 44, city: 'Москва', region: 'Москва', lat: 55.75, lon: 37.62, zone: 0 },
  { code: 137, city: 'Санкт-Петербург', region: 'Санкт-Петербург', lat: 59.94, lon: 30.31, zone: 1 },
  { code: 424, city: 'Казань', region: 'Татарстан', lat: 55.79, lon: 49.11, zone: 1 },
  { code: 270, city: 'Новосибирск', region: 'Новосибирская область', lat: 55.03, lon: 82.92, zone: 3 },
  { code: 250, city: 'Екатеринбург', region: 'Свердловская область', lat: 56.84, lon: 60.6, zone: 2 },
  { code: 438, city: 'Краснодар', region: 'Краснодарский край', lat: 45.04, lon: 38.98, zone: 2 },
];
const STREETS = ['ул. Ленина, 12', 'пр-т Мира, 45', 'ул. Садовая, 7'];
const FLOW: { code: string; name: string; status: ShipmentStatus | null }[] = [
  { code: 'CREATED', name: 'Создан', status: null },
  { code: 'RECEIVED_AT_SHIPMENT_WAREHOUSE', name: 'Принят на склад отправителя', status: 'in_transit' },
  { code: 'SENT_TO_RECIPIENT_CITY', name: 'Отправлен в г. получателя', status: 'in_transit' },
  { code: 'ACCEPTED_AT_PICK_UP_POINT', name: 'Принят на склад до востребования', status: 'ready_for_pickup' },
  { code: 'DELIVERED', name: 'Вручен', status: 'delivered' },
];

/** Минимальный PDF из одной строки латиницей — для накладной в офлайн-режиме. */
function tinyPdf(line: string): Buffer {
  const text = line.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '');
  const stream = `BT /F1 14 Tf 40 780 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * Офлайн-СДЭК для тестов и разработки без сети: тарифы по зонам, по три ПВЗ на город,
 * статус продвигается на шаг при каждом опросе.
 */
export class FakeDeliveryProvider implements DeliveryProvider {
  readonly name = 'fake' as const;
  private readonly orders = new Map<string, { number: string; step: number; track: string }>();

  async cities(query: string): Promise<City[]> {
    const q = query.trim().toLowerCase();
    return CITIES.filter((c) => c.city.toLowerCase().startsWith(q)).map(({ code, city, region }) => ({ code, city, region }));
  }

  async points(cityCode: number): Promise<Point[]> {
    const c = CITIES.find((x) => x.code === cityCode);
    if (!c) return [];
    return STREETS.map((street, i) => ({
      code: `${c.code}-PVZ${i + 1}`,
      name: `СДЭК ${c.city}, ${street}`,
      address: street,
      workTime: 'Пн-Вс 09:00-21:00',
      lat: c.lat + i * 0.01,
      lon: c.lon + i * 0.01,
      reception: true,
    }));
  }

  async quote(from: number, to: number, parcel: Parcel): Promise<Quote[]> {
    const a = CITIES.find((c) => c.code === from);
    const b = CITIES.find((c) => c.code === to);
    if (!a || !b) return [];
    const zone = Math.abs(a.zone - b.zone) + (a.code === b.code ? 0 : 1);
    const kg = Math.max(1, Math.ceil(parcel.weightG / 1000));
    const pvz = 200 + zone * 90 + (kg - 1) * 40;
    const days = 1 + zone * 2;
    return [
      { type: 'pvz', tariffCode: 136, price: pvz * 100, periodMin: days, periodMax: days + 1 },
      { type: 'courier', tariffCode: 137, price: (pvz + 145) * 100, periodMin: days, periodMax: days + 1 },
    ];
  }

  async createOrder(input: CreateDeliveryOrder): Promise<{ uuid: string }> {
    const uuid = randomUUID();
    this.orders.set(uuid, { number: input.number, step: 0, track: String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)) });
    return { uuid };
  }

  async getOrder(uuid: string): Promise<DeliveryOrderState> {
    const o = this.orders.get(uuid);
    if (!o) return { trackNo: null, statusCode: null, status: null, statusName: null };
    const s = FLOW[Math.min(o.step, FLOW.length - 1)];
    o.step++;
    return { trackNo: o.track, statusCode: s.code, statusName: s.name, status: s.status };
  }

  async print(uuid: string, kind: 'waybill' | 'barcode'): Promise<Buffer> {
    const o = this.orders.get(uuid);
    return tinyPdf(`${kind === 'waybill' ? 'CDEK waybill (test)' : 'CDEK label (test)'} ${o?.number ?? uuid} track ${o?.track ?? '-'}`);
  }
}
