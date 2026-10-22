import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrdersTable } from './OrdersTable';

export const metadata: Metadata = { title: 'Заказы' };

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersTable />
    </Suspense>
  );
}
