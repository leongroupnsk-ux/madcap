import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import {
  inviteMemberSchema,
  supplierApplicationSchema,
  supplierSettingsSchema,
  type SupplierApplicationInput,
  type SupplierSettingsInput,
} from '@aesculap/shared';
import { CurrentUser } from '../auth/auth.guard';
import { publicUser } from '../auth/auth.service';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentSupplier, SupplierAccess, type SupplierContext } from './supplier.guard';
import { SuppliersService } from './suppliers.service';

@Controller()
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Post('supplier-applications')
  apply(@Body(new ZodPipe(supplierApplicationSchema)) body: SupplierApplicationInput, @Req() req: Request) {
    return this.suppliers.apply(body, req.ip ?? 'unknown');
  }

  @Get('supplier/me')
  @SupplierAccess()
  me(@CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return { user: publicUser(user), role: ctx.role, supplier: this.suppliers.view(ctx.supplier) };
  }

  @Put('supplier/settings')
  @SupplierAccess('owner')
  settings(@Body(new ZodPipe(supplierSettingsSchema)) body: SupplierSettingsInput, @CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return this.suppliers.updateSettings(ctx.supplier, body, user);
  }

  @Get('supplier/members')
  @SupplierAccess('owner')
  members(@CurrentSupplier() ctx: SupplierContext) {
    return this.suppliers.members(ctx.supplier.id);
  }

  @Post('supplier/members')
  @SupplierAccess('owner')
  invite(@Body(new ZodPipe(inviteMemberSchema)) body: { email: string; role: 'catalog' | 'warehouse' }, @CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return this.suppliers.invite(ctx.supplier, body.email, body.role, user);
  }

  @Delete('supplier/members/:userId')
  @SupplierAccess('owner')
  remove(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() user: User, @CurrentSupplier() ctx: SupplierContext) {
    return this.suppliers.removeMember(ctx.supplier, userId, user);
  }
}
