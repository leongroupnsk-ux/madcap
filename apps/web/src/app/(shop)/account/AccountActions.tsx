'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, ButtonLink, Card } from '@/components/ui';
import { api } from '@/lib/api';

export function AccountActions({ email, emailVerified, welcome }: { email: string; emailVerified: boolean; welcome: boolean }) {
  const router = useRouter();
  const [resent, setResent] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
      {welcome && <Alert tone="success">Аккаунт создан. Мы отправили письмо для подтверждения email.</Alert>}
      <Card>
        <div className="eyebrow">Аккаунт</div>
        <p style={{ margin: '8px 0 16px' }}>
          {email} · {emailVerified ? 'email подтверждён' : 'email не подтверждён'}
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {!emailVerified && (
            <Button
              variant="soft"
              disabled={resent}
              onClick={async () => {
                await api('/auth/resend-verification', {});
                setResent(true);
              }}
            >
              {resent ? 'Письмо отправлено' : 'Отправить письмо ещё раз'}
            </Button>
          )}
          <ButtonLink href="/quiz/1" variant="accent">
            Пройти анкету
          </ButtonLink>
          <Button
            variant="outline"
            onClick={async () => {
              await api('/auth/logout', {});
              router.replace('/');
              router.refresh();
            }}
          >
            Выйти
          </Button>
        </div>
      </Card>
    </div>
  );
}
