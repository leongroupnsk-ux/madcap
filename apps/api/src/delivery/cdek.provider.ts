import { BadGatewayException, Logger } from '@nestjs/common';
import { config } from '../config';
import { mapCdekStatus, type City, type CreateDeliveryOrder, type DeliveryOrderState, type DeliveryProvider, type Parcel, type Point, type Quote } from './delivery.provider';

/** Тарифы «Посылка»: склад-склад (до ПВЗ) и склад-дверь (курьер); запасные — «Экспресс». */
const TARIFFS = { pvz: [136, 483], courier: [137, 482] } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rub = (kop: number) => Math.round(kop) / 100;

/** СДЭК API v2 (ТЗ §10). Тестовый контур — https://api.edu.cdek.ru/v2. */
export class CdekProvider implements DeliveryProvider {
  readonly name = 'cdek' as const;
  private readonly logger = new Logger('CDEK');
  private token: { value: string; until: number } | null = null;

  private async auth(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const { cdekUrl, cdekClientId, cdekSecret } = config.delivery;
    const res = await fetch(`${cdekUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cdekClientId, client_secret: cdekSecret }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new BadGatewayException({ message: 'СДЭК: не удалось авторизоваться' });
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
    return body.access_token;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${config.delivery.cdekUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.auth()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = json?.requests?.[0]?.errors?.[0]?.message ?? json?.errors?.[0]?.message ?? res.statusText;
      this.logger.warn(`${method} ${path} → ${res.status}: ${err}`);
      throw new BadGatewayException({ message: `СДЭК: ${err}` });
    }
    return json as T;
  }

  async cities(query: string): Promise<City[]> {
    // Подсказки по началу названия: «Каза» → Казань, Казацкое…
    const rows = await this.call<{ code: number; full_name: string }[]>('GET', `/location/suggest/cities?country_code=RU&name=${encodeURIComponent(query)}`);
    return rows.slice(0, 10).map((c) => {
      const [city, ...rest] = c.full_name.split(', ');
      return { code: c.code, city, region: rest.filter((x) => x !== 'Россия').join(', ') };
    });
  }

  async points(cityCode: number): Promise<Point[]> {
    const rows = await this.call<any[]>('GET', `/deliverypoints?city_code=${cityCode}&type=PVZ&country_code=RU`);
    return rows
      .filter((p) => p.is_handout !== false)
      .map((p) => ({
        code: p.code,
        name: p.name,
        address: p.location?.address ?? p.location?.address_full ?? '',
        workTime: p.work_time ?? '',
        lat: p.location?.latitude ?? 0,
        lon: p.location?.longitude ?? 0,
        reception: Boolean(p.is_reception),
      }));
  }

  async quote(from: number, to: number, parcel: Parcel): Promise<Quote[]> {
    const res = await this.call<{ tariff_codes?: { tariff_code: number; delivery_sum: number; period_min: number; period_max: number }[] }>('POST', '/calculator/tarifflist', {
      from_location: { code: from },
      to_location: { code: to },
      packages: [{ weight: parcel.weightG, length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm }],
    });
    const list = res.tariff_codes ?? [];
    const out: Quote[] = [];
    for (const type of ['pvz', 'courier'] as const) {
      const t = TARIFFS[type].map((code) => list.find((x) => x.tariff_code === code)).find(Boolean);
      if (t) out.push({ type, tariffCode: t.tariff_code, price: Math.ceil(t.delivery_sum) * 100, periodMin: t.period_min, periodMax: t.period_max });
    }
    return out;
  }

  async createOrder(o: CreateDeliveryOrder): Promise<{ uuid: string }> {
    const res = await this.call<{ entity?: { uuid: string } }>('POST', '/orders', {
      type: 1,
      number: o.number,
      tariff_code: o.tariffCode,
      shipment_point: o.shipmentPoint,
      ...(o.to.type === 'pvz' ? { delivery_point: o.to.pvzCode } : { to_location: { code: o.to.cityCode, address: o.to.address } }),
      recipient: { name: o.recipient.name, email: o.recipient.email, phones: [{ number: o.recipient.phone }] },
      // Форма собственности по справочнику СДЭК: 137 — организация (ИНН 10 цифр), 63 — ИП (12 цифр); переопределяется в .env.
      seller: { name: o.seller.name, inn: o.seller.inn, phone: o.seller.phone, ownership_form: o.seller.inn.length === 12 ? config.delivery.cdekFormIp : config.delivery.cdekFormOrg },
      packages: [
        {
          number: '1',
          weight: o.parcel.weightG,
          length: o.parcel.lengthCm,
          width: o.parcel.widthCm,
          height: o.parcel.heightCm,
          items: o.items.map((i) => ({ name: i.name.slice(0, 255), ware_key: i.sku.slice(0, 50), payment: { value: 0 }, cost: rub(i.price), weight: i.weightG, amount: i.qty })),
        },
      ],
    });
    if (!res.entity?.uuid) throw new BadGatewayException({ message: 'СДЭК не вернул идентификатор заказа' });
    // Заказ проверяется асинхронно: ждём итог, чтобы не сохранить заказ, который СДЭК отклонил.
    for (let i = 0; i < 10; i++) {
      await sleep(700);
      const st = await this.call<{ requests?: { type: string; state: string; errors?: { message: string }[] }[] }>('GET', `/orders/${res.entity.uuid}`);
      const create = st.requests?.find((r) => r.type === 'CREATE');
      if (create?.state === 'INVALID') throw new BadGatewayException({ message: `СДЭК отклонил заказ: ${create.errors?.map((e) => e.message).join('; ') ?? 'ошибка проверки'}` });
      if (create?.state === 'SUCCESSFUL') break;
    }
    return { uuid: res.entity.uuid };
  }

  async getOrder(uuid: string): Promise<DeliveryOrderState> {
    const res = await this.call<{ entity?: { cdek_number?: string; statuses?: { code: string; name: string; date_time: string }[] } }>('GET', `/orders/${uuid}`);
    const statuses = [...(res.entity?.statuses ?? [])].sort((a, b) => b.date_time.localeCompare(a.date_time));
    const last = statuses[0];
    return { trackNo: res.entity?.cdek_number ?? null, statusCode: last?.code ?? null, statusName: last?.name ?? null, status: last ? mapCdekStatus(last.code) : null };
  }

  async print(uuid: string, kind: 'waybill' | 'barcode'): Promise<Buffer> {
    const path = kind === 'waybill' ? '/print/orders' : '/print/barcodes';
    const created = await this.call<{ entity: { uuid: string } }>('POST', path, { orders: [{ order_uuid: uuid }], copy_count: 1, ...(kind === 'barcode' ? { format: 'A6' } : {}) });
    // Формирование PDF асинхронное: ждём статуса READY до ~15 секунд.
    for (let i = 0; i < 15; i++) {
      const st = await this.call<{ entity: { url?: string; statuses?: { code: string }[] } }>('GET', `${path}/${created.entity.uuid}`);
      if (st.entity.url) {
        const pdf = await fetch(st.entity.url, { headers: { Authorization: `Bearer ${await this.auth()}` }, signal: AbortSignal.timeout(20000) });
        if (!pdf.ok) break;
        return Buffer.from(await pdf.arrayBuffer());
      }
      if (st.entity.statuses?.some((s) => s.code === 'INVALID')) break;
      await sleep(1000);
    }
    throw new BadGatewayException({ message: 'СДЭК не сформировал PDF, попробуйте через минуту' });
  }
}
