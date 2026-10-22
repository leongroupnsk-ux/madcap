import type { Metadata } from 'next';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import type { Dictionaries } from '@/lib/types';
import { ProductForm } from '../ProductForm';

export const metadata: Metadata = { title: 'Новый товар' };

export default async function NewProductPage() {
  if (!(await requireSupplier())) return null;
  const dict = (await serverApi<Dictionaries>('/dictionaries')).data!;
  return <ProductForm dict={dict} />;
}
