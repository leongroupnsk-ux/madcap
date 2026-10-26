import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  acceptInviteSchema,
  totpCodeSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type LoginInput,
  type RegisterInput,
} from '@aesculap/shared';
import { CaptchaService, captchaToken } from '../common/captcha.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuthGuard, CurrentUser } from './auth.guard';
import { AuthService, publicUser } from './auth.service';
import { SessionService } from './session.service';

const ip = (req: Request) => req.ip ?? 'unknown';


@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly captcha: CaptchaService,
  ) {}

  /** Ключ клиента SmartCaptcha; null — капча выключена. Форма запрашивает его только после captcha_required. */
  @Get('captcha-config')
  captchaConfig() {
    return { siteKey: this.captcha.siteKey };
  }

  @Post('register')
  async register(
    @Body(new ZodPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.register(body, ip(req), captchaToken(req));
    await this.sessions.create(user.id, req, res);
    return { user: publicUser(user) };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body, ip(req), captchaToken(req));
    await this.sessions.create(user.id, req, res);
    return { user: publicUser(user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(req, res);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: User) {
    return { user: { ...publicUser(user), hasCapsule: await this.auth.hasCapsule(user.id) } };
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async resend(@CurrentUser() user: User) {
    if (!user.emailVerifiedAt) await this.auth.sendVerification(user);
  }

  @Post('forgot-password')
  @HttpCode(204)
  async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }, @Req() req: Request) {
    await this.auth.forgotPassword(body.email, ip(req), captchaToken(req));
  }

  @Post('reset-password')
  @HttpCode(200)
  async reset(
    @Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.resetPassword(body.token, body.password);
    await this.sessions.create(user.id, req, res);
    return { user: publicUser(user) };
  }

  @Post('accept-invite')
  @HttpCode(200)
  async acceptInvite(
    @Body(new ZodPipe(acceptInviteSchema)) body: { token: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.acceptInvite(body.token, body.password);
    await this.sessions.create(user.id, req, res);
    return { user: publicUser(user) };
  }

  @Post('totp/setup')
  @UseGuards(AuthGuard)
  totpSetup(@CurrentUser() user: User) {
    return this.auth.totpSetup(user);
  }

  @Post('totp/enable')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async totpEnable(@CurrentUser() user: User, @Body(new ZodPipe(totpCodeSchema)) body: { code: string }) {
    return { user: publicUser(await this.auth.totpEnable(user, body.code)) };
  }

  @Post('totp/disable')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async totpDisable(@CurrentUser() user: User, @Body(new ZodPipe(totpCodeSchema)) body: { code: string }) {
    return { user: publicUser(await this.auth.totpDisable(user, body.code)) };
  }
}
