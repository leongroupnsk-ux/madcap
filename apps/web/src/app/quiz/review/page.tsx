import { serverApi } from '@/lib/server-api';
import type { Dictionaries } from '@/lib/types';
import { Review } from './Review';

export default async function ReviewPage() {
  const dict = (await serverApi<Dictionaries>('/dictionaries')).data;
  return <Review groups={dict?.specialtyGroups ?? []} />;
}
