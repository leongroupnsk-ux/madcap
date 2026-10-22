import type { Metadata } from 'next';
import { serverApi } from '@/lib/server-api';
import { requireSupplier } from '@/lib/supplier-session';
import { Settings } from './Settings';

export const metadata: Metadata = { title: 'Настройки' };

type Member = { userId: string; email: string; role: 'owner' | 'catalog' | 'warehouse'; activated: boolean };

export default async function SettingsPage() {
  const me = await requireSupplier();
  if (!me) return null;
  const members = me.role === 'owner' ? ((await serverApi<Member[]>('/supplier/members')).data ?? []) : [];
  return <Settings me={me} initialMembers={members} />;
}
