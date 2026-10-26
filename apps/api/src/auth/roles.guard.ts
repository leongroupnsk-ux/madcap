import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, applyDecorators, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { canAccess, twofaSetupRequired, type StaffArea } from '@aesculap/shared';
import type { User, UserRole } from '@prisma/client';
import { SettingsService } from '../common/settings.service';
import { AuthGuard } from './auth.guard';

const ROLES = 'roles';
const AREA = 'staffArea';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest<{ user?: User }>().user;
    if (!user) throw new UnauthorizedException({ message: 'Нужно войти' });
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException({ message: 'Недостаточно прав' });
    // Обязательная 2FA: пока сотрудник её не включил, вся админка закрыта. Включение (/api/auth/totp/*),
    // /api/auth/me и выход живут вне @Roles и остаются доступны.
    if (user.role === 'admin' && twofaSetupRequired({ role: user.role, staffRole: user.staffRole, totpEnabled: Boolean(user.totpEnabledAt) }, await this.settings.security())) {
      throw new ForbiddenException({ message: 'Для вашей роли обязателен вход с кодом из приложения. Включите двухфакторную защиту.', code: 'twofa_setup_required' });
    }
    // Сотрудник админки видит только свои разделы (ТЗ §8)
    const area = this.reflector.getAllAndOverride<StaffArea>(AREA, [ctx.getHandler(), ctx.getClass()]);
    if (area && user.role === 'admin' && !canAccess(user.staffRole, area)) throw new ForbiddenException({ message: 'Этот раздел недоступен для вашей роли' });
    return true;
  }
}

/** Доступ только для перечисленных ролей (после проверки сессии). */
export const Roles = (...roles: UserRole[]) => applyDecorators(SetMetadata(ROLES, roles), UseGuards(AuthGuard, RolesGuard));

/** Раздел админки: кроме владельца, доступен только ролям из STAFF_AREAS (ставится вместе с @Roles('admin')). */
export const Area = (area: StaffArea) => SetMetadata(AREA, area);
