import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import type { Dictionaries } from '@/lib/types';
import { Profile, type OrderRow, type ProfileData } from './Profile';

export const metadata: Metadata = { title: 'Мой профиль', robots: { index: false } };

type Capsule = { count: number; total: number } | null;

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/account');
  const [{ welcome }, profile, consents, capsule, dict, orders] = await Promise.all([
    searchParams,
    serverApi<ProfileData>('/me/profile'),
    serverApi<Record<string, boolean>>('/me/consents'),
    serverApi<Capsule>('/me/capsule'),
    serverApi<Dictionaries>('/dictionaries'),
    serverApi<OrderRow[]>('/orders'),
  ]);
  const names = (dict.data?.specialtyGroups ?? []).flatMap((g) => g.specialties).filter((s) => profile.data?.specialtyIds.includes(s.id)).map((s) => s.name);
  return (
    <Profile
      email={user.email}
      emailVerified={user.emailVerified}
      welcome={welcome === '1'}
      profile={profile.data!}
      specialties={names}
      consents={consents.data ?? {}}
      capsule={capsule.data ?? null}
      orders={orders.data ?? []}
    />
  );
}
