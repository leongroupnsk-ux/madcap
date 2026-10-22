/** Суммы — в копейках. */
export type ReceiptItem = {
  description: string;
  quantity: number;
  /** Цена за единицу */
  amount: number;
  vatCode: number;
  subject: 'commodity' | 'service';
  /** Агентская схема: товар продаёт поставщик, платформа — агент (ТЗ §6.3) */
  supplier?: { name: string; inn: string };
};
export type Receipt = { customer: { email: string; phone?: string }; items: ReceiptItem[] };
/** Перечисление поставщику: сумма его товаров и удерживаемая комиссия платформы */
export type Transfer = { accountId: string; amount: number; platformFee: number; description?: string };

export type CreatePayment = {
  idempotenceKey: string;
  amount: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  receipt: Receipt;
  transfers: Transfer[];
};

export type PaymentState = {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  amount: number;
  /** «Карта •••• 1234» / «СБП» */
  method: string | null;
  metadata: Record<string, string>;
};

export type CreateRefund = {
  idempotenceKey: string;
  paymentId: string;
  amount: number;
  description: string;
  /** Возврат сплит-платежа: из чьих перечислений списываются деньги */
  sources: Transfer[];
  receipt: Receipt;
};

export interface PaymentsProvider {
  readonly name: 'fake' | 'yookassa';
  createPayment(input: CreatePayment): Promise<{ id: string; status: PaymentState['status']; confirmationUrl: string | null }>;
  getPayment(id: string): Promise<PaymentState>;
  createRefund(input: CreateRefund): Promise<{ id: string; status: 'pending' | 'succeeded' | 'canceled' }>;
}

export const PAYMENTS_PROVIDER = Symbol('PAYMENTS_PROVIDER');

export const money = (kop: number) => ({ value: (kop / 100).toFixed(2), currency: 'RUB' });
export const kop = (value: string) => Math.round(Number(value) * 100);
