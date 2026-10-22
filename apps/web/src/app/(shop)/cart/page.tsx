import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/session';
import { CartView } from './CartView';

export const metadata: Metadata = { title: 'Корзина', robots: { index: false } };

export default async function CartPage() {
  const user = await getSessionUser();
  return <CartView signedIn={Boolean(user)} />;
}
