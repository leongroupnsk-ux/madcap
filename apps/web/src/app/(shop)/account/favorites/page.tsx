import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/session';
import { Favorites } from './Favorites';

export const metadata: Metadata = { title: 'Избранное', robots: { index: false } };

/** Избранное: у гостя — из браузера, у вошедшего — из аккаунта (синхронизирует FavoritesSync); подписки на поступление — у вошедшего */
export default async function FavoritesPage() {
  const user = await getSessionUser();
  return <Favorites signedIn={user?.role === 'buyer'} />;
}
