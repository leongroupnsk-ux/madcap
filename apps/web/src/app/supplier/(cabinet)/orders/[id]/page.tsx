import type { Metadata } from 'next';
import { ShipmentDetail } from './ShipmentDetail';

export const metadata: Metadata = { title: 'Заказ' };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShipmentDetail id={id} />;
}
