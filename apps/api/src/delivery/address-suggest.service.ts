import { Injectable, Logger } from '@nestjs/common';
import { sha256 } from '../common/crypto';
import { RedisService } from '../common/redis.service';
import { config } from '../config';
import { DeliveryService } from './delivery.service';

/** Подсказка адреса курьера: «улица, дом» для поля формы + город с кодом СДЭК (null — сопоставить не удалось) */
export type AddressSuggestion = {
  /** Как показать в списке: «г Казань, ул Баумана, д 12» */
  value: string;
  /** Для поля «Улица и дом»: «ул Баумана, д 12» */
  street: string;
  house: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  cityCode: number | null;
};

type DadataAddress = {
  value: string;
  data: {
    postal_code?: string | null;
    region_with_type?: string | null;
    city?: string | null;
    city_with_type?: string | null;
    city_kladr_id?: string | null;
    settlement?: string | null;
    settlement_with_type?: string | null;
    settlement_kladr_id?: string | null;
    street_with_type?: string | null;
    house_type?: string | null;
    house?: string | null;
    block_type?: string | null;
    block?: string | null;
  };
};

const CACHE_TTL = 3600;
const CDEK_ID_TTL = 30 * 86400;

/**
 * DaData «Подсказки по адресам» (ТЗ §6.2, E4-10). Ключ живёт только на сервере; без ключа — пустой список,
 * форма курьера работает как раньше. Ответы кэшируются в Redis на час, ошибки и таймауты — пустой список.
 */
@Injectable()
export class AddressSuggestService {
  private readonly logger = new Logger('DaData');

  constructor(
    private readonly redis: RedisService,
    private readonly delivery: DeliveryService,
  ) {}

  get enabled(): boolean {
    return Boolean(config.dadata.apiKey);
  }

  async suggest(q: string, city?: string): Promise<AddressSuggestion[]> {
    const query = q.trim().slice(0, 200);
    const inCity = city?.trim().slice(0, 60) || undefined;
    if (!this.enabled || query.length < 3) return [];
    const key = `dadata:addr:${sha256(`${inCity ?? ''}|${query.toLowerCase()}`)}`;
    const hit = await this.redis.client.get(key);
    if (hit) return JSON.parse(hit) as AddressSuggestion[];

    const rows = await this.call<{ suggestions?: DadataAddress[] }>('/suggest/address', {
      query,
      count: 7,
      // Город уже выбран в форме — ищем улицы и дома в нём
      ...(inCity ? { locations: [{ city: inCity }, { settlement: inCity }], restrict_value: true } : {}),
      from_bound: { value: 'city' },
      to_bound: { value: 'house' },
    });
    if (!rows) return [];
    const list: AddressSuggestion[] = [];
    for (const s of rows.suggestions ?? []) {
      const d = s.data;
      const cityName = d.city ?? d.settlement;
      if (!cityName) continue;
      const house = d.house ? [d.house_type, d.house, d.block_type, d.block].filter(Boolean).join(' ') : null;
      const street = [d.street_with_type ?? (d.city ? d.settlement_with_type : null), house].filter(Boolean).join(', ');
      if (!street) continue;
      list.push({
        value: s.value,
        street,
        house,
        city: cityName,
        region: d.region_with_type ?? null,
        postalCode: d.postal_code ?? null,
        cityCode: await this.cdekCityCode(d.settlement_kladr_id ?? d.city_kladr_id ?? null, cityName, d.region_with_type ?? null),
      });
    }
    await this.redis.client.set(key, JSON.stringify(list), 'EX', CACHE_TTL);
    return list;
  }

  /**
   * Код города СДЭК: сначала справочник DaData «ID службы доставки» по КЛАДР,
   * если не нашёлся — поиск городов СДЭК по названию (точное совпадение, при нескольких — по региону).
   */
  private async cdekCityCode(kladr: string | null, city: string, region: string | null): Promise<number | null> {
    if (kladr) {
      const key = `dadata:cdek:${kladr}`;
      const cached = await this.redis.client.get(key);
      if (cached) return cached === '0' ? null : Number(cached);
      const res = await this.call<{ suggestions?: { data?: { cdek_id?: string | null } }[] }>('/findById/delivery', { query: kladr });
      const id = Number(res?.suggestions?.[0]?.data?.cdek_id);
      if (res) await this.redis.client.set(key, Number.isFinite(id) && id > 0 ? String(id) : '0', 'EX', CDEK_ID_TTL);
      if (Number.isFinite(id) && id > 0) return id;
    }
    try {
      const same = (await this.delivery.cities(city)).filter((c) => c.city.toLowerCase() === city.toLowerCase());
      // «Респ Татарстан» ~ «Татарстан», «Свердловская обл» ~ «Свердловская область»: сравниваем по главному слову
      const word = (r: string) => r.toLowerCase().replace(/(^|\s)(г|респ|республика|обл|область|край|ао)(\.|\s|$)/g, ' ').trim().split(/\s+/)[0] ?? '';
      const byRegion = region ? same.find((c) => c.region && word(c.region) === word(region)) : undefined;
      return (byRegion ?? same[0])?.code ?? null;
    } catch {
      return null;
    }
  }

  /** POST в DaData с таймаутом; null — сервис недоступен или ответил ошибкой */
  private async call<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${config.dadata.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${config.dadata.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.dadata.timeoutMs),
      });
      if (!res.ok) {
        this.logger.warn(`${path} → HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (e) {
      this.logger.warn(`${path} недоступен: ${(e as Error).message}`);
      return null;
    }
  }
}
