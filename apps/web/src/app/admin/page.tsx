import { serverApi } from '@/lib/server-api';
import { Applications, type Application } from './Applications';

export const metadata = { title: 'Заявки поставщиков' };

export default async function AdminPage() {
  const apps = (await serverApi<Application[]>('/admin/applications')).data ?? [];
  return <Applications initial={apps} />;
}
