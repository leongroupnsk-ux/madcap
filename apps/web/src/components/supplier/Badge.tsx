import s from './cabinet.module.css';

/** Подписи статусов — общие для кабинета поставщика и админки (components/admin/Badge.tsx) */
export const BADGE_LABELS: Record<string, string> = {
  draft: 'Черновик', pending: 'На модерации', published: 'Опубликован', rejected: 'Отклонён', hidden: 'Снят с витрины',
  revision: 'Правки на модерации', queued: 'В очереди', checking: 'Проверяем', checked: 'Проверен', applying: 'Применяем',
  applied: 'Применён', failed: 'Ошибка', new: 'Новая', approved: 'Одобрена', active: 'Активен',
};

export function Badge({ status, children }: { status: string; children?: React.ReactNode }) {
  return <span className={`${s.badge} ${s[`b_${status}`] ?? ''}`}>{children ?? BADGE_LABELS[status] ?? status}</span>;
}
