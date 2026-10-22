import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Премиум-коллекция' };

// Раздел «Премиум» вне MVP (ТЗ §1, вопрос §14); пока — анонс.
export default function PremiumPage() {
  return (
    <section className="container" style={{ padding: '48px var(--gutter)' }}>
      <div style={{ background: 'var(--c-premium)', color: '#fff', borderRadius: 20, padding: '56px 40px', display: 'grid', gap: 16, maxWidth: 820 }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20 }}>{BRAND.mark} premium</span>
        <h1 style={{ color: '#fff', fontSize: 'clamp(36px, 5vw, 56px)' }}>Больше, чем униформа</h1>
        <p style={{ color: 'rgba(255,255,255,.75)', maxWidth: 480, margin: 0 }}>
          Премиальная коллекция готовится к запуску. Пока соберите базовую капсулу — подберём форму под вашу специальность и бюджет.
        </p>
        <div>
          <ButtonLink href="/quiz/1" variant="accent">
            Подобрать капсулу
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
