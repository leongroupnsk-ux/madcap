import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import type { Dictionaries, Product } from '@/lib/types';
import { ProductForm } from '../ProductForm';
import { SupplierReviews } from '../SupplierReviews';

export const metadata: Metadata = { title: 'Товар' };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  if (!(await requireSupplier())) return null;
  const { id } = await params;
  const { created } = await searchParams;
  const [dict, product] = await Promise.all([serverApi<Dictionaries>('/dictionaries'), serverApi<Product>(`/supplier/products/${id}`)]);
  if (!product.data) notFound();
  return (
    <>
      {created && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="success">Черновик сохранён. Добавьте фото (минимум 3) и отправьте на модерацию.</Alert>
        </div>
      )}
      <ProductForm key={product.data.updatedAt} dict={dict.data!} initial={product.data} />
      <SupplierReviews productId={product.data.id} />
    </>
  );
}
