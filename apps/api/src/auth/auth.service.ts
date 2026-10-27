import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthTokenType, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import { twofaSetupRequired, type LoginInput, type RegisterInput } from '@aesculap/shared';
import { AuditService } from '../common/audit.service';
import { SettingsService } from '../common/settings.service';
import { LegalService } from '../common/legal.service';
import { PrismaService } from '../common/prisma.service';
import { MailTemplatesService } from '../common/mail-templates.service';
import { CaptchaService } from '../common/captcha.service';
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
  phone: u.phone,
  staffRole: u.role === 'admin' ? (u.staffRole ?? 'owner') : null,
  totpEnabled: Boolean(u.totpEnabledAt),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailTemplatesService,
    private readonly limits: RateLimitService,
    private readonly legal: LegalService,
    private readonly captcha: CaptchaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Сотруднику нужно включить 2FA, прежде чем работать в админке (настройка «Безопасность»). */
  async twofaSetupRequired(user: User): Promise<boolean> {
    if (user.role !== 'admin') return false;
    return twofaSetupRequired({ role: user.role, staffRole: user.staffRole, totpEnabled: Boolean(user.totpEnabledAt) }, await this.settings.security());
  }

  async register(input: RegisterInput, ip: string, captchaToken?: string): Promise<User> {
    await this.limits.hit('register', ip, 10, 3600, this.captcha.gate(captchaToken, ip));
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException({ message: 'Аккаунт с таким email уже есть', errors: { email: 'Аккаунт с таким email уже есть' } });

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        consents: {
          create: [
            { type: 'pdn', version: await this.legal.consentVersion('pdn'), ip },
            { type: 'offer', version: await this.legal.consentVersion('offer'), ip },
          ],
        },
      },
    });
    await this.sendVerification(user);
    return user;
  }

  async login(input: LoginInput, ip: string, captchaToken?: string): Promise<User> {
    // Один «шлюз» на оба счётчика: токен капчи одноразовый и проверяется один раз
    const captcha = this.captcha.gate(captchaToken, ip);
    await this.limits.hit('login-ip', ip, 20, 900, captcha);
    await this.limits.hit('login', input.email, 5, 900, captcha);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), input.password).catch(() => false);
    if (!user || !ok || user.deletedAt) throw new UnauthorizedException({ message: 'Неверный email или пароль' });
    // О блокировке говорим только после верного пароля — иначе это раскрывало бы наличие аккаунта.
    if (user.blockedAt) throw new ForbiddenException({ message: 'Аккаунт заблокирован. Напишите в поддержку.', code: 'blocked' });
    if (user.totpEnabledAt && user.totpSecret) {
      // Пароль верный, нужен второй фактор: клиент показывает поле кода.
      if (!input.totp) throw new UnauthorizedException({ message: 'Введите код из приложения-аутентификатора', code: 'totp_required' });
      if (!verifyTotp(user.totpSecret, input.totp)) {
        throw new UnauthorizedException({ message: 'Неверный код подтверждения', code: 'totp_required', errors: { totp: 'Неверный код' } });
      }
    }
    await this.limits.reset('login', input.email);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
    return user;
  }

  async hasCapsule(userId: string): Promise<boolean> {
    return (await this.prisma.buyerProfile.count({ where: { userId, quizCompletedAt: { not: null } } })) > 0;
  }

  async sendVerification(user: User): Promise<void> {
    const token = await this.issueToken(user.id, 'email_verify', config.tokens.emailVerifyHours * 60);
    await this.mail.send('auth.verify_email', user.email, { link: `${config.webOrigin}/verify-email?token=${token}`, hours: config.tokens.emailVerifyHours });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeToken(token, 'email_verify');
    await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  }

  /** Ответ одинаковый для существующего и несуществующего email (ТЗ §4.7). */
  async forgotPassword(email: string, ip: string, captchaToken?: string): Promise<void> {
    const captcha = this.captcha.gate(captchaToken, ip);
    await this.limits.hit('forgot-ip', ip, 10, 3600, captcha);
    await this.limits.hit('forgot', email, 3, 3600, captcha);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) return;
    const token = await this.issueToken(user.id, 'password_reset', config.tokens.passwordResetMinutes);
    await this.mail.send('auth.password_reset', user.email, { link: `${config.webOrigin}/reset-password?token=${token}`, minutes: config.tokens.passwordResetMinutes });
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

  /** Приглашение сотрудника админки: ссылка на установку пароля (тот же механизм, что сброс), живёт 7 дней. */
  async sendStaffInvite(user: User, roleLabel: string): Promise<void> {
    const token = await this.issueToken(user.id, 'password_reset', 7 * 24 * 60);
    await this.mail.send('auth.staff_invite', user.email, { role: roleLabel, link: `${config.webOrigin}/reset-password?token=${token}` });
  }

  /**
   * Аккаунт, созданный менеджером для заказа из премиум-заявки: пароль никто не знает, покупатель задаёт его
   * по ссылке (механизм сброса пароля, 7 дней — как у приглашения сотрудника). Email подтверждается при установке пароля.
   */
  async sendAccountSetup(user: User, name: string, orderNumber: string): Promise<void> {
    const token = await this.issueToken(user.id, 'password_reset', 7 * 24 * 60);
    await this.mail.send('auth.account_created', user.email, { name, link: `${config.webOrigin}/reset-password?token=${token}`, 'order.number': orderNumber });
  }

  /** Письмо-приглашение сотруднику поставщика: ссылка на установку пароля, живёт 7 дней. */
  async sendSupplierInvite(user: User, supplierName: string): Promise<void> {
    const token = await this.issueToken(user.id, 'supplier_invite', 7 * 24 * 60);
    await this.mail.send('supplier.invite', user.email, { 'supplier.name': supplierName, link: `${config.webOrigin}/supplier/invite?token=${token}` });
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
    await this.limits.hit('totp', user.id, 5, 900);
    if (!user.totpSecret || !verifyTotp(user.totpSecret, code)) {
      throw new BadRequestException({ message: 'Неверный код', errors: { code: 'Неверный код' } });
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    if (user.role === 'admin') await this.audit.log(user.id, 'auth.2fa.enable', 'user', user.id);
    return updated;
  }

  async totpDisable(user: User, code: string) {
    // Для ролей из обязательного списка выключить нельзя — иначе админка сразу закроется до повторной настройки
    if (user.role === 'admin' && (await this.settings.security()).require2faRoles.includes(user.staffRole ?? 'owner')) {
      throw new BadRequestException({ message: 'Для вашей роли двухфакторная защита обязательна — отключить её нельзя', code: 'twofa_required_by_policy' });
    }
    await this.limits.hit('totp', user.id, 5, 900);
    if (!user.totpSecret || !user.totpEnabledAt || !verifyTotp(user.totpSecret, code)) {
      throw new BadRequestException({ message: 'Неверный код', errors: { code: 'Неверный код' } });
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: null, totpSecret: null } });
    if (user.role === 'admin') await this.audit.log(user.id, 'auth.2fa.disable', 'user', user.id);
    return updated;
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

  /** Атомарно: из двух одновременных запросов с одной ссылкой проходит только один. */
  private async consumeToken(token: string, type: AuthTokenType) {
    const tokenHash = sha256(token);
    const now = new Date();
    const used = await this.prisma.authToken.updateMany({ where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (used.count === 0) throw new BadRequestException({ message: 'Ссылка недействительна или устарела. Запросите новую.' });
    return this.prisma.authToken.findUniqueOrThrow({ where: { tokenHash } });
  }
}
