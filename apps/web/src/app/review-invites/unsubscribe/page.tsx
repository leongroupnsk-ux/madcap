import type { Metadata } from 'next';
import { ReviewInvitesUnsubscribe } from './ReviewInvitesUnsubscribe';

export const metadata: Metadata = { title: 'Отписка от писем об отзывах', robots: { index: false } };

/**
 * Ссылка «Отписаться» из письма «Как вам покупка?». Страница вне витринной группы (shop): своя минимальная
 * обёртка — карточка с логотипом, как у отписки от рассылки.
 */
export default async function ReviewInvitesUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main>
      <ReviewInvitesUnsubscribe token={token ?? ''} />
    </main>
  );
}
