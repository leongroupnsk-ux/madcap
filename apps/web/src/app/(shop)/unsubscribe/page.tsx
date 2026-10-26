import type { Metadata } from 'next';
import { Unsubscribe } from './Unsubscribe';

export const metadata: Metadata = { title: 'Отписка от рассылки', robots: { index: false } };

/** Ссылка «Отписаться» из писем об акциях (ТЗ §11): отзывает согласие на рассылку. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <Unsubscribe token={token ?? ''} />;
}
