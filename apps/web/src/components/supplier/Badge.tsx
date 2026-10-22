import s from './cabinet.module.css';

const LABELS: Record<string, string> = {
  draft: 'Черновик', pending: 'На модерации', published: 'Опубликован', rejected: 'Отклонён', hidden: 'Снят с витрины',
  revision: 'Правки на модерации', queued: 'В очереди', checking: 'Проверяем', checked: 'Проверен', applying: 'Применяем',
  applied: 'Применён', failed: 'Ошибка', new: 'Новая', approved: 'Одобрена', active: 'Активен',
};

export function Badge({ status, children }: { status: string; children?: React.ReactNode }) {
  return <span className={`${s.badge} ${s[`b_${status}`] ?? ''}`}>{children ?? LABELS[status] ?? status}</span>;
}
