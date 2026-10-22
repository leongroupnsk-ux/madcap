import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ConsentType, User } from '@prisma/client';
import type { Request } from 'express';
import { profileUpdateSchema, type ProfileUpdate } from '@aesculap/shared';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { CapsuleService } from './capsule.service';
import { ProfileService } from './profile.service';

const consentSchema = z.object({ type: z.enum(['pdn', 'offer', 'photos', 'marketing']), granted: z.boolean() });
const replaceSchema = z.object({ variantId: z.string().uuid() });

/** Личные данные покупателя: анкета, согласия, фото, капсула (ТЗ §5, §6.5). */
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly capsules: CapsuleService,
  ) {}

  @Get('profile')
  profile(@CurrentUser() user: User) {
    return this.profiles.get(user);
  }

  @Put('profile')
  async update(@CurrentUser() user: User, @Body(new ZodPipe(profileUpdateSchema)) body: ProfileUpdate) {
    const res = await this.profiles.update(user, body);
    if (body.complete) await this.capsules.build(user.id);
    return res;
  }

  @Get('consents')
  consents(@CurrentUser() user: User) {
    return this.profiles.consents(user);
  }

  @Post('consents')
  @HttpCode(200)
  setConsent(@CurrentUser() user: User, @Body(new ZodPipe(consentSchema)) body: { type: ConsentType; granted: boolean }, @Req() req: Request) {
    return this.profiles.setConsent(user, body.type, body.granted, req.ip ?? 'unknown');
  }

  @Post('photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1048576, files: 1 } }))
  photo(@CurrentUser() user: User, @UploadedFile() file: Express.Multer.File | undefined, @Body('angle') angle?: string) {
    if (!file) throw new BadRequestException({ message: 'Выберите фото' });
    return this.profiles.addPhoto(user, file, angle);
  }

  @Get('photos/:id')
  @Header('Content-Type', 'image/webp')
  @Header('Cache-Control', 'private, no-store')
  async photoFile(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return new StreamableFile(await this.profiles.photoStream(user, id));
  }

  @Delete('photos/:id')
  deletePhoto(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.deletePhoto(user, id);
  }

  @Get('capsule')
  capsule(@CurrentUser() user: User, @Query('variant') variant?: string) {
    return this.capsules.get(user, Math.min(3, Math.max(1, Number(variant) || 1)));
  }

  @Post('capsule/rebuild')
  @HttpCode(200)
  async rebuild(@CurrentUser() user: User) {
    await this.capsules.build(user.id);
    return this.capsules.get(user, 1);
  }

  @Get('capsule/:variantNo/:slot/alternatives')
  alternatives(@CurrentUser() user: User, @Param('variantNo', ParseIntPipe) variantNo: number, @Param('slot') slot: string) {
    return this.capsules.alternatives(user, variantNo, slot);
  }

  @Put('capsule/:variantNo/:slot')
  replace(@CurrentUser() user: User, @Param('variantNo', ParseIntPipe) variantNo: number, @Param('slot') slot: string, @Body(new ZodPipe(replaceSchema)) body: { variantId: string }) {
    return this.capsules.replace(user, variantNo, slot, body.variantId);
  }
}
