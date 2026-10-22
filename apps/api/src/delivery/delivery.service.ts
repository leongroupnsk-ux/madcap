import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis.service';
import { DELIVERY_PROVIDER, type City, type DeliveryProvider, type Parcel, type Point, type Quote } from './delivery.provider';

type ParcelItem = { qty: number; weightG?: number | null; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null };

/** Габариты посылки по товарам: вес суммируется, вещи складываются стопкой. */
export function parcelOf(items: ParcelItem[]): Parcel {
  let weightG = 0;
  let lengthCm = 30;
  let widthCm = 25;
  let heightCm = 0;
  for (const i of items) {
    weightG += (i.weightG ?? 400) * i.qty;
    lengthCm = Math.max(lengthCm, Math.ceil((i.lengthMm ?? 300) / 10));
    widthCm = Math.max(widthCm, Math.ceil((i.widthMm ?? 250) / 10));
    heightCm += Math.ceil((i.heightMm ?? 50) / 10) * i.qty;
  }
  return { weightG: Math.max(weightG, 100), lengthCm, widthCm, heightCm: Math.min(Math.max(heightCm, 5), 80) };
}

/** Тарифы и пункты СДЭК с кэшем в Redis (тарифы — 15 минут, ТЗ §10). */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DELIVERY_PROVIDER) readonly provider: DeliveryProvider,
    private readonly redis: RedisService,
  ) {}

  private async cached<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.redis.client.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await load();
    await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlS);
    return value;
  }

  cities(q: string): Promise<City[]> {
    const query = q.trim();
    if (query.length < 2) return Promise.resolve([]);
    return this.cached(`dlv:${this.provider.name}:cities:${query.toLowerCase()}`, 86400, () => this.provider.cities(query));
  }

  points(cityCode: number): Promise<Point[]> {
    return this.cached(`dlv:${this.provider.name}:points:${cityCode}`, 3600, () => this.provider.points(cityCode));
  }

  quote(from: number, to: number, parcel: Parcel): Promise<Quote[]> {
    const key = `dlv:${this.provider.name}:quote:${from}:${to}:${parcel.weightG}:${parcel.lengthCm}x${parcel.widthCm}x${parcel.heightCm}`;
    return this.cached(key, 900, () => this.provider.quote(from, to, parcel));
  }
}
