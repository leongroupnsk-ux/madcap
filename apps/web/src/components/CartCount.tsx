'use client';

import { useEffect, useState } from 'react';
import { onCartChange, readCart } from '@/lib/cart';
import s from './site.module.css';

export function CartCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => setN(readCart().reduce((sum, l) => sum + l.qty, 0));
    update();
    return onCartChange(update);
  }, []);
  return n > 0 ? <span className={s.badge}>{n}</span> : null;
}
