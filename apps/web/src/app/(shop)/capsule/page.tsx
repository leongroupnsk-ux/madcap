import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/server-api';
import { getSessionUser } from '@/lib/session';
import { CapsuleView, type CapsuleData } from './CapsuleView';

export const metadata: Metadata = { title: 'Моя капсула', robots: { index: false } };

export default async function CapsulePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/capsule');
  const res = await serverApi<CapsuleData | null>('/me/capsule');
  if (!res.data) redirect('/quiz/1');
  return <CapsuleView initial={res.data} />;
}
