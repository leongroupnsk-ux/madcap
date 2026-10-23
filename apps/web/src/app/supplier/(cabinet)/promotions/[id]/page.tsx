import type { Metadata } from 'next';
import { requireSupplier } from '@/lib/supplier-session';
import { PromotionProducts } from './PromotionProducts';

export const metadata: Metadata = { title: 'Акция' };

export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireSupplier();
  if (!me) return null;
  const { id } = await params;
  return <PromotionProducts id={id} baseBp={me.supplier.commissionBp} />;
}
