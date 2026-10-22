import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthTokenType, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import { CONSENT_VERSIONS, type LoginInput, type RegisterInput } from '@aesculap/shared';
import { PrismaService } from '../common/prisma.service';
import { MailService } from '../common/mail.service';
import { RateLimitService } from '../common/rate-limit.service';
import { newToken, sha256 } from '../common/crypto';
import { newTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { config } from '../config';

// Хэш-заглушка: проверка пароля идёт и для несуществующего email, чтобы время ответа не выдавало аккаунт.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argon2.hash('timing-equalizer', { type: argon2.argon2id }));

export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  emailVerified: Boolean(u.emailVerifiedAt),
  totpEnabled: Boolean(u.totpEnabledAt),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly limits: RateLimitService,
  ) {}

  async register(input: RegisterInput, ip: string): Promise<User> {
    await this.limits.hit('register', ip, 10, 3600);
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException({ message: 'Аккаунт с таким email уже есть', errors: { email: 'Аккаунт с таким email уже есть' } });

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        consents: {
          create: [
            { type: 'pdn', version: CONSENT_VERSIONS.pdn, ip },
            { type: 'offer', version: CONSENT_VERSIONS.offer, ip },
          ],
        },
      },
    });
    await this.sendVerification(user);
    return user;
  }

  async login(input: LoginInput, ip: string): Promise<User> {
    await this.limits.hit('login-ip', ip, 20, 900);
    await this.limits.hit('login', input.email, 5, 900);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), input.password).catch(() => false);
    if (!user || !ok || user.deletedAt) throw new UnauthorizedException({ message: 'Неверный email или пароль' });
    if (user.totpEnabledAt && user.totpSecret) {
      // Пароль верный, нужен второй фактор: клиент показывает поле кода.
      if (!input.totp) throw new UnauthorizedException({ message: 'Введите код из приложения-аутентификатора', code: 'totp_required' });
      if (!verifyTotp(user.totpSecret, input.totp)) {
        throw new UnauthorizedException({ message: 'Неверный код подтверждения', code: 'totp_required', errors: { totp: 'Неверный код' } });
      }
    }
    await this.limits.reset('login', input.email);
    return user;
  }

  async sendVerification(user: User): Promise<void> {
    const token = await this.issueToken(user.id, 'email_verify', config.tokens.emailVerifyHours * 60);
    await this.mail.send({
      to: user.email,
      subject: `Подтвердите email — ${config.brandName}`,
      text: `Чтобы подтвердить email, перейдите по ссылке:\n${config.webOrigin}/verify-email?token=${token}\n\nСсылка действует ${config.tokens.emailVerifyHours} ч.`,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeToken(token, 'email_verify');
    await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  }

  /** Ответ одинаковый для существующего и несуществующего email (ТЗ §4.7). */
  async forgotPassword(email: string, ip: string): Promise<void> {
    await this.limits.hit('forgot-ip', ip, 10, 3600);
    await this.limits.hit('forgot', email, 3, 3600);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) return;
    const token = await this.issueToken(user.id, 'password_reset', config.tokens.passwordResetMinutes);
    await this.mail.send({
      to: user.email,
      subject: `Восстановление пароля — ${config.brandName}`,
      text: `Чтобы задать новый пароль, перейдите по ссылке:\n${config.webOrigin}/reset-password?token=${token}\n\nСсылка одноразовая и действует ${config.tokens.passwordResetMinutes} минут. Если вы не запрашивали сброс, просто проигнорируйте письмо.`,
    });
  }

  /** Новый пароль; все сессии пользователя закрываются. Возвращает пользователя для автовхода. */
  async resetPassword(token: string, password: string): Promise<User> {
    const record = await this.consumeToken(token, 'password_reset');
    const user = await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }), emailVerifiedAt: new Date() },
    });
    await this.prisma.session.deleteMany({ where: { userId: user.id } });
    return user;
  }

  /** Письмо-приглашение сотруднику поставщика: ссылка на установку пароля, живёт 7 дней. */
  async sendSupplierInvite(user: User, supplierName: string): Promise<void> {
    const token = await this.issueToken(user.id, 'supplier_invite', 7 * 24 * 60);
    await this.mail.send({
      to: user.email,
      subject: `Доступ в кабинет поставщика — ${config.brandName}`,
      text: `Вас пригласили в кабинет поставщика «${supplierName}».\nЧтобы задать пароль и войти, перейдите по ссылке:\n${config.webOrigin}/supplier/invite?token=${token}\n\nСсылка действует 7 дней.`,
    });
  }

  async acceptInvite(token: string, password: string): Promise<User> {
    const record = await this.consumeToken(token, 'supplier_invite');
    return this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }), emailVerifiedAt: new Date() },
    });
  }

  /** Шаг 1 включения 2FA: секрет сохраняется, но не активен до подтверждения кодом. */
  async totpSetup(user: User) {
    if (user.totpEnabledAt) throw new BadRequestException({ message: '2FA уже включена' });
    const secret = newTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    return { secret, otpauthUrl: otpauthUrl(config.brandName, user.email, secret) };
  }

  async totpEnable(user: User, code: string) {
    if (!user.totpSecret || !verifyTotp(user.totpSecret, code)) {
      throw new BadRequestException({ message: 'Неверный код', errors: { code: 'Неверный код' } });
    }
    return this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
  }

  async totpDisable(user: User, code: string) {
    if (!user.totpSecret || !user.totpEnabledAt || !verifyTotp(user.totpSecret, code)) {
      throw new BadRequestException({ message: 'Неверный код', errors: { code: 'Неверный код' } });
    }
    return this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: null, totpSecret: null } });
  }

  private async issueToken(userId: string, type: AuthTokenType, ttlMinutes: number): Promise<string> {
    // Новый токен отменяет прежние неиспользованные того же типа.
    await this.prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
    const token = newToken();
    await this.prisma.authToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    });
    return token;
  }

  private async consumeToken(token: string, type: AuthTokenType) {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException({ message: 'Ссылка недействительна или устарела. Запросите новую.' });
    }
    await this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return record;
  }
}
