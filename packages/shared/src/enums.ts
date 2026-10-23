export const UserRole = { buyer: 'buyer', supplier_staff: 'supplier_staff', admin: 'admin' } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Тип согласия; версия текста хранится вместе с фактом согласия (ТЗ §11). */
export const ConsentType = { pdn: 'pdn', offer: 'offer', photos: 'photos', marketing: 'marketing' } as const;
export type ConsentType = (typeof ConsentType)[keyof typeof ConsentType];

/** Текущие версии юридических текстов — меняются вместе с текстами. */
export const CONSENT_VERSIONS: Record<ConsentType, string> = {
  pdn: '2026-10-23',
  offer: '2026-10-22',
  photos: '2026-10-23',
  marketing: '2026-10-23',
};

/** Слоты капсулы (ТЗ §5.2). */
export const CapsuleSlot = { top: 'top', pants: 'pants', gown: 'gown', shoes: 'shoes', accessory: 'accessory' } as const;
export type CapsuleSlot = (typeof CapsuleSlot)[keyof typeof CapsuleSlot];
