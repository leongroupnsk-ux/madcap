import type { Metadata } from 'next';
import { CartView } from './CartView';

export const metadata: Metadata = { title: 'Корзина', robots: { index: false } };

export default function CartPage() {
  return <CartView />;
}
