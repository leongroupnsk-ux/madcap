import type { Metadata } from 'next';
import { CapsuleView } from './CapsuleView';

export const metadata: Metadata = { title: 'Премиум-капсула', robots: { index: false } };

export default function PremiumCapsulePage() {
  return <CapsuleView />;
}
