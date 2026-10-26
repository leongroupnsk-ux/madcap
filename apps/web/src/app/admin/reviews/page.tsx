import { AdminReviews } from './AdminReviews';

export const metadata = { title: 'Модерация отзывов' };

/** Очередь отзывов покупателей (раздел «Модерация»): одобрить или отклонить с причиной */
export default function AdminReviewsPage() {
  return <AdminReviews />;
}
