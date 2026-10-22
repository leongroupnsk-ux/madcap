import type { Metadata } from 'next';
import { Payouts } from './Payouts';

export const metadata: Metadata = { title: 'Выплаты' };

export default function PayoutsPage() {
  return <Payouts />;
}
