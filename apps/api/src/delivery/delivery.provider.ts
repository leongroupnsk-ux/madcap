import type { ShipmentStatus } from '@prisma/client';

export type City = { code: number; city: string; region: string };
export type Point = { code: string; name: string; address: string; workTime: string; lat: number; lon: number; reception: boolean };
export type Parcel = { weightG: number; lengthCm: number; widthCm: number; heightCm: number };
/** Цена — в копейках, сроки — в днях */
export type Quote = { type: 'pvz' | 'courier'; tariffCode: number; price: number; periodMin: number; periodMax: number };

export type CreateDeliveryOrder = {
  /** Наш номер отправления: «100001-2» */
  number: string;
  tariffCode: number;
  /** Пункт СДЭК, куда поставщик сдаёт посылку */
  shipmentPoint: string;
  to: { type: 'pvz' | 'courier'; cityCode: number; pvzCode?: string | null; address?: string };
  recipient: { name: string; phone: string; email: string };
  seller: { name: string; inn: string; phone: string };
  parcel: Parcel;
  items: { name: string; sku: string; price: number; qty: number; weightG: number }[];
};

export type DeliveryOrderState = { trackNo: string | null; statusCode: string | null; status: ShipmentStatus | null; statusName: string | null };

export interface DeliveryProvider {
  readonly name: 'fake' | 'cdek';
  cities(query: string): Promise<City[]>;
  points(cityCode: number): Promise<Point[]>;
  quote(fromCityCode: number, toCityCode: number, parcel: Parcel): Promise<Quote[]>;
  createOrder(input: CreateDeliveryOrder): Promise<{ uuid: string }>;
  getOrder(uuid: string): Promise<DeliveryOrderState>;
  /** PDF накладной (waybill) или этикеток (barcode) */
  print(uuid: string, kind: 'waybill' | 'barcode'): Promise<Buffer>;
}

export const DELIVERY_PROVIDER = Symbol('DELIVERY_PROVIDER');

/** Коды статусов СДЭК → статус нашего отправления; остальные лишь пишутся в таймлайн. */
export function mapCdekStatus(code: string): ShipmentStatus | null {
  if (['DELIVERED'].includes(code)) return 'delivered';
  if (['ACCEPTED_AT_PICK_UP_POINT', 'POSTOMAT_POSTED'].includes(code)) return 'ready_for_pickup';
  if (
    [
      'RECEIVED_AT_SHIPMENT_WAREHOUSE', 'READY_TO_SHIP_AT_SENDING_OFFICE', 'READY_FOR_SHIPMENT_IN_SENDER_CITY', 'TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY',
      'SENT_TO_TRANSIT_CITY', 'ACCEPTED_IN_TRANSIT_CITY', 'ACCEPTED_AT_TRANSIT_WAREHOUSE', 'READY_TO_SHIP_IN_TRANSIT_OFFICE',
      'TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY', 'SENT_TO_RECIPIENT_CITY', 'ACCEPTED_IN_RECIPIENT_CITY', 'ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE', 'TAKEN_BY_COURIER',
    ].includes(code)
  )
    return 'in_transit';
  return null;
}
