import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductsTable } from './ProductsTable';

export const metadata: Metadata = { title: 'Товары' };

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsTable />
    </Suspense>
  );
}
