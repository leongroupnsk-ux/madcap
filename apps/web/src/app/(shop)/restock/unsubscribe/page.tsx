import type { Metadata } from 'next';
import { RestockUnsubscribe } from './RestockUnsubscribe';

export const metadata: Metadata = { title: 'Отписка от уведомлений о поступлении', robots: { index: false } };

/** Ссылка «Отписаться» из писем «Сообщить о поступлении»: закрывает все подписки этого email. */
export default async function RestockUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <RestockUnsubscribe token={token ?? ''} />;
}
