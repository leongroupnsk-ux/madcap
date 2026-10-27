'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Меню админки: активный раздел отмечен aria-current="page" (и выделен стилем, как в кабинете поставщика). */
export function AdminNav({ items, className, activeClass }: { items: { href: string; label: string }[]; className?: string; activeClass?: string }) {
  const path = usePathname();
  // Самый длинный подходящий адрес: /admin/orders/… — «Заказы и платежи», /admin/system/mail-templates — «Шаблоны писем»
  const active = items
    .filter((i) => path === i.href || path.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className={className} aria-label="Админка">
      {items.map((n) => (
        <Link key={n.href} href={n.href} className={n.href === active ? activeClass : undefined} aria-current={n.href === active ? 'page' : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
