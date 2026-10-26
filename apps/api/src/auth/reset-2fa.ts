import type { PrismaClient } from '@prisma/client';

/**
 * Аварийный сброс 2FA (сотрудник потерял телефон): выключает вход по коду и закрывает все сессии.
 * Запускается с сервера скриптом scripts/reset-2fa.ts; в журнал действий пишется от имени «система».
 * Пароль не меняется — после входа сотрудник с обязательной 2FA сразу попадёт на её повторную настройку.
 */
export async function resetTwoFactor(prisma: PrismaClient, email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.deletedAt) throw new Error(`Пользователь ${email} не найден`);
  const [, sessions] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: null, totpSecret: null } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.auditLog.create({
      data: { actorId: null, action: 'auth.2fa.reset', entity: 'user', entityId: user.id, data: { email: user.email, via: 'scripts/reset-2fa.ts', hadTwoFactor: Boolean(user.totpEnabledAt) } },
    }),
  ]);
  return { userId: user.id, email: user.email, hadTwoFactor: Boolean(user.totpEnabledAt), sessionsClosed: sessions.count };
}
