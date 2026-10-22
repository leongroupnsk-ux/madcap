import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, applyDecorators, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User, UserRole } from '@prisma/client';
import { AuthGuard } from './auth.guard';

const ROLES = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest<{ user?: User }>().user;
    if (!user) throw new UnauthorizedException({ message: 'Нужно войти' });
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException({ message: 'Недостаточно прав' });
    return true;
  }
}

/** Доступ только для перечисленных ролей (после проверки сессии). */
export const Roles = (...roles: UserRole[]) => applyDecorators(SetMetadata(ROLES, roles), UseGuards(AuthGuard, RolesGuard));
