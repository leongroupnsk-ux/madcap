import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import type { SavedAddress } from './AddressDrawer';
import { Checkout } from './Checkout';

export const metadata: Metadata = { title: 'Оформление заказа', robots: { index: false } };

export default async function CheckoutPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/checkout');
  const [addresses, profile] = await Promise.all([serverApi<SavedAddress[]>('/me/addresses'), serverApi<{ name: string | null }>('/me/profile')]);
  return <Checkout saved={addresses.data ?? []} recipient={{ name: profile.data?.name ?? '', phone: user.phone ?? '', email: user.email }} />;
}
