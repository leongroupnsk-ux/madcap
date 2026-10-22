import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RedisService } from '../common/redis.service';
import { config } from '../config';
import type { CreatePayment, CreateRefund, PaymentState, PaymentsProvider } from './payments.provider';

type Stored = PaymentState & { description: string; request: CreatePayment; refunds: CreateRefund[] };

/**
 * Тестовая платёжка без ЮKassa: платёж хранится в Redis, «оплата» — на нашей странице /pay/test/:id.
 * Повтор с тем же ключом идемпотентности возвращает тот же платёж, как у ЮKassa.
 */
export class FakePaymentsProvider implements PaymentsProvider {
  readonly name = 'fake' as const;
  constructor(private readonly redis: RedisService) {}

  private key = (id: string) => `fakepay:${id}`;

  async load(id: string): Promise<Stored> {
    const raw = await this.redis.client.get(this.key(id));
    if (!raw) throw new NotFoundException({ message: 'Платёж не найден' });
    return JSON.parse(raw) as Stored;
  }

  private save(p: Stored) {
    return this.redis.client.set(this.key(p.id), JSON.stringify(p), 'EX', 7 * 86400);
  }

  async createPayment(input: CreatePayment) {
    const existing = await this.redis.client.get(`fakepay:idem:${input.idempotenceKey}`);
    const id = existing ?? `test-${randomUUID()}`;
    if (!existing) {
      await this.save({ id, status: 'pending', amount: input.amount, method: null, metadata: input.metadata, description: input.description, request: input, refunds: [] });
      await this.redis.client.set(`fakepay:idem:${input.idempotenceKey}`, id, 'EX', 86400);
    }
    return { id, status: 'pending' as const, confirmationUrl: `${config.webOrigin}/pay/test/${id}` };
  }

  async getPayment(id: string): Promise<PaymentState> {
    const { status, amount, method, metadata } = await this.load(id);
    return { id, status, amount, method, metadata };
  }

  /** Действие на тестовой странице оплаты */
  async settle(id: string, result: 'card' | 'sbp' | 'fail') {
    const p = await this.load(id);
    if (p.status !== 'pending') return p;
    p.status = result === 'fail' ? 'canceled' : 'succeeded';
    p.method = result === 'card' ? 'Карта •••• 4242' : result === 'sbp' ? 'СБП' : null;
    await this.save(p);
    return p;
  }

  async createRefund(input: CreateRefund) {
    const p = await this.load(input.paymentId);
    const refunded = p.refunds.reduce((s, r) => s + r.amount, 0);
    if (p.status !== 'succeeded' || refunded + input.amount > p.amount) throw new NotFoundException({ message: 'Возврат больше суммы платежа' });
    if (!p.refunds.some((r) => r.idempotenceKey === input.idempotenceKey)) p.refunds.push(input);
    await this.save(p);
    return { id: `test-refund-${input.idempotenceKey}`, status: 'succeeded' as const };
  }
}
