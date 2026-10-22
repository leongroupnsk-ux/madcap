import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards, applyDecorators, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Supplier, SupplierMemberRole, User } from '@prisma/client';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';

export type SupplierContext = { supplier: Supplier; role: SupplierMemberRole };
type Req = Request & { user?: User; supplierCtx?: SupplierContext };

const MEMBER_ROLES = 'supplierRoles';

/**
 * Изоляция поставщиков (ТЗ §11): все запросы кабинета работают только в контексте
 * поставщика, членом которого является пользователь. Заголовок X-Supplier-Id выбирает
 * поставщика, если их несколько.
 */
@Injectable()
export class SupplierGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const wanted = req.headers['x-supplier-id'];
    const members = await this.prisma.supplierMember.findMany({
      where: { userId: req.user!.id, ...(typeof wanted === 'string' ? { supplierId: wanted } : {}) },
      include: { supplier: true },
      orderBy: { supplier: { createdAt: 'asc' } },
      take: 1,
    });
    const member = members[0];
    if (!member) throw new ForbiddenException({ message: 'Нет доступа к кабинету поставщика' });
    if (member.supplier.status === 'blocked') throw new ForbiddenException({ message: 'Кабинет поставщика заблокирован. Свяжитесь с поддержкой.' });
    const allowed = this.reflector.getAllAndOverride<SupplierMemberRole[]>(MEMBER_ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (allowed?.length && !allowed.includes(member.role)) throw new ForbiddenException({ message: 'Недостаточно прав в кабинете поставщика' });
    req.supplierCtx = { supplier: member.supplier, role: member.role };
    return true;
  }
}

/** Доступ к кабинету поставщика; без аргументов — любой сотрудник. */
export const SupplierAccess = (...roles: SupplierMemberRole[]) =>
  applyDecorators(SetMetadata(MEMBER_ROLES, roles), UseGuards(AuthGuard, SupplierGuard));

export const CurrentSupplier = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Req>().supplierCtx as SupplierContext);
