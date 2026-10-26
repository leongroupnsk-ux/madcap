import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import type { DeliveryFeatures, SavedAddress } from './AddressDrawer';
import { Checkout } from './Checkout';

export const metadata: Metadata = { title: 'Оформление заказа', robots: { index: false } };

export default async function CheckoutPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/checkout');
  // features — включены ли карта ПВЗ и подсказки адреса (ключи живут в API; браузер за этим отдельно не ходит)
  const [addresses, profile, features] = await Promise.all([
    serverApi<SavedAddress[]>('/me/addresses'),
    serverApi<{ name: string | null }>('/me/profile'),
    serverApi<DeliveryFeatures>('/delivery/config'),
  ]);
  return (
    <Checkout
      saved={addresses.data ?? []}
      recipient={{ name: profile.data?.name ?? '', phone: user.phone ?? '', email: user.email }}
      features={features.data ?? { mapKey: null, addressSuggest: false }}
    />
  );
}
