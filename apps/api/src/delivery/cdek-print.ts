import { BadGatewayException, Logger } from '@nestjs/common';
import { config } from '../config';

/**
 * Массовая печать СДЭК: один PDF с накладными (/print/orders) или этикетками (/print/barcodes) сразу для нескольких
 * заказов — СДЭК принимает до 100 order_uuid в одном запросе. Отдельный файл, чтобы не трогать CdekProvider
 * (там тарифы и заказы); авторизация — тот же client_credentials, токен кэшируется здесь же.
 */
const logger = new Logger('CDEK print');
let token: { value: string; until: number } | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function auth(): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const { cdekUrl, cdekClientId, cdekSecret } = config.delivery;
  const res = await fetch(`${cdekUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cdekClientId, client_secret: cdekSecret }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new BadGatewayException({ message: 'СДЭК: не удалось авторизоваться' });
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
  return body.access_token;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.delivery.cdekUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await auth()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = json?.requests?.[0]?.errors?.[0]?.message ?? json?.errors?.[0]?.message ?? res.statusText;
    logger.warn(`${method} ${path} → ${res.status}: ${err}`);
    throw new BadGatewayException({ message: `СДЭК: ${err}` });
  }
  return json as T;
}

export async function cdekPrintMany(uuids: string[], kind: 'waybill' | 'barcode'): Promise<Buffer> {
  const path = kind === 'waybill' ? '/print/orders' : '/print/barcodes';
  const created = await call<{ entity: { uuid: string } }>('POST', path, { orders: uuids.map((order_uuid) => ({ order_uuid })), copy_count: 1, ...(kind === 'barcode' ? { format: 'A6' } : {}) });
  // PDF формируется асинхронно; на пачку ждём дольше, чем на один заказ — до ~30 секунд
  for (let i = 0; i < 30; i++) {
    const st = await call<{ entity: { url?: string; statuses?: { code: string }[] } }>('GET', `${path}/${created.entity.uuid}`);
    if (st.entity.url) {
      const pdf = await fetch(st.entity.url, { headers: { Authorization: `Bearer ${await auth()}` }, signal: AbortSignal.timeout(30000) });
      if (!pdf.ok) break;
      return Buffer.from(await pdf.arrayBuffer());
    }
    if (st.entity.statuses?.some((s) => s.code === 'INVALID')) break;
    await sleep(1000);
  }
  throw new BadGatewayException({ message: 'СДЭК не сформировал PDF, попробуйте через минуту' });
}
