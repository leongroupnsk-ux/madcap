import { BadGatewayException, Logger } from '@nestjs/common';
import { config } from '../config';
import { kop, money, type CreatePayment, type CreateRefund, type PaymentState, type PaymentsProvider, type Receipt, type Transfer } from './payments.provider';

const API = 'https://api.yookassa.ru/v3';

function receiptBody(r: Receipt) {
  return {
    customer: { email: r.customer.email, ...(r.customer.phone ? { phone: r.customer.phone.replace(/^\+/, '') } : {}) },
    items: r.items.map((i) => ({
      description: i.description.slice(0, 128),
      quantity: i.quantity.toFixed(2),
      amount: money(i.amount),
      vat_code: i.vatCode,
      payment_mode: 'full_payment',
      payment_subject: i.subject,
      ...(i.supplier ? { agent_type: 'agent', supplier: { name: i.supplier.name.slice(0, 256), inn: i.supplier.inn } } : {}),
    })),
  };
}

const transferBody = (t: Transfer) => ({
  account_id: t.accountId,
  amount: money(t.amount),
  platform_fee_amount: money(t.platformFee),
  ...(t.description ? { description: t.description.slice(0, 128) } : {}),
});

function methodLabel(pm: any): string | null {
  if (!pm) return null;
  if (pm.type === 'bank_card') return pm.card?.last4 ? `Карта •••• ${pm.card.last4}` : 'Банковская карта';
  if (pm.type === 'sbp') return 'СБП';
  return pm.title ?? pm.type;
}

/**
 * ЮKassa для платформ (сплитование): платёж с transfers, чек «Чеки от ЮKassa» с признаком агента,
 * возвраты с sources. Ключ идемпотентности — в заголовке Idempotence-Key (ТЗ §10).
 */
export class YooKassaProvider implements PaymentsProvider {
  readonly name = 'yookassa' as const;
  private readonly logger = new Logger('YooKassa');

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotenceKey?: string): Promise<T> {
    const { yookassaShopId, yookassaSecret } = config.payments;
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${yookassaShopId}:${yookassaSecret}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotenceKey ? { 'Idempotence-Key': idempotenceKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      this.logger.warn(`${method} ${path} → ${res.status}: ${json?.description ?? res.statusText}`);
      throw new BadGatewayException({ message: 'Платёжный сервис временно недоступен, попробуйте ещё раз' });
    }
    return json as T;
  }

  async createPayment(p: CreatePayment) {
    const res = await this.call<any>(
      'POST',
      '/payments',
      {
        amount: money(p.amount),
        capture: true,
        confirmation: { type: 'redirect', return_url: p.returnUrl },
        description: p.description.slice(0, 128),
        metadata: p.metadata,
        receipt: receiptBody(p.receipt),
        // Аварийный режим: без transfers деньги остаются платформе, поставщикам — реестром
        ...(p.transfers.length ? { transfers: p.transfers.map(transferBody) } : {}),
      },
      p.idempotenceKey,
    );
    return { id: res.id as string, status: res.status, confirmationUrl: res.confirmation?.confirmation_url ?? null };
  }

  async getPayment(id: string): Promise<PaymentState> {
    const res = await this.call<any>('GET', `/payments/${encodeURIComponent(id)}`);
    return { id: res.id, status: res.status, amount: kop(res.amount.value), method: methodLabel(res.payment_method), metadata: res.metadata ?? {} };
  }

  async createRefund(r: CreateRefund) {
    const res = await this.call<any>(
      'POST',
      '/refunds',
      { payment_id: r.paymentId, amount: money(r.amount), description: r.description.slice(0, 250), ...(r.sources.length ? { sources: r.sources.map(transferBody) } : {}), receipt: receiptBody(r.receipt) },
      r.idempotenceKey,
    );
    return { id: res.id as string, status: res.status };
  }
}
