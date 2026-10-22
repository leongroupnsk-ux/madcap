import { ButtonLink } from '@/components/ui';

export default function NotFound() {
  return (
    <section className="container" style={{ padding: '80px var(--gutter)', textAlign: 'center' }}>
      <div className="eyebrow">Ошибка 404</div>
      <h1 style={{ fontSize: 48, margin: '12px 0 16px' }}>Такой страницы нет</h1>
      <p style={{ color: 'var(--c-text-muted)' }}>Возможно, товар сняли с продажи или ссылка устарела.</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
        <ButtonLink href="/catalog">В каталог</ButtonLink>
        <ButtonLink href="/" variant="outline">
          На главную
        </ButtonLink>
      </div>
    </section>
  );
}
