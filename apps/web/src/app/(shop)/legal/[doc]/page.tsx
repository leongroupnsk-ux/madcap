import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

const DOCS: Record<string, string> = {
  offer: 'Публичная оферта',
  privacy: 'Политика обработки персональных данных',
  delivery: 'Доставка и возврат',
};

type P = Promise<{ doc: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  const title = DOCS[(await params).doc];
  return { title: title ?? 'Документ', robots: { index: false } };
}

// Тексты готовит юрист до запуска (E6-02); здесь — место под них.
export default async function LegalPage({ params }: { params: P }) {
  const { doc } = await params;
  const title = DOCS[doc];
  if (!title) notFound();
  return (
    <section className="container" style={{ padding: '48px var(--gutter)', maxWidth: 760 }}>
      <h1 style={{ fontSize: 40, marginBottom: 16 }}>{title}</h1>
      <p style={{ color: 'var(--c-text-muted)' }}>Текст документа будет опубликован до запуска площадки.</p>
      {doc === 'delivery' && (
        <ul style={{ lineHeight: 1.8 }}>
          <li>Доставка СДЭК: пункт выдачи или курьер, обычно 2–4 дня.</li>
          <li>Каждый поставщик отправляет свою часть заказа со своего склада.</li>
          <li>Отмена — до передачи в доставку; возврат — 7 дней после получения.</li>
        </ul>
      )}
    </section>
  );
}
