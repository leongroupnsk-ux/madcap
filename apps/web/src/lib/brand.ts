/** Название вынесено в одно место: смена бренда — одна правка (ТЗ §14, вопрос 1). */
export const BRAND = { name: 'aesculap', mark: 'aesculap.' } as const;

export const CATEGORY_NAV = [
  { href: '/catalog/kostyumy', label: 'Костюмы' },
  { href: '/catalog/halaty', label: 'Халаты' },
  { href: '/catalog/topy', label: 'Топы' },
  { href: '/catalog/bryuki', label: 'Брюки' },
  { href: '/catalog/obuv', label: 'Обувь' },
  { href: '/catalog/golovnye-ubory', label: 'Головные уборы' },
  { href: '/journal', label: 'Журнал' },
  { href: '/suppliers', label: 'Поставщикам' },
  { href: '/catalog?sale=1', label: 'Распродажа', tone: 'sale' },
  { href: '/premium', label: 'Премиум', tone: 'strong' },
] as const;
