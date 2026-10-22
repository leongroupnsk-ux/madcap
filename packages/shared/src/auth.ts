import { z } from 'zod';

export const PASSWORD_MIN = 8;

export const emailSchema = z.string().trim().toLowerCase().email('Введите корректный email').max(254);
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Не менее ${PASSWORD_MIN} символов`)
  .max(128, 'Не более 128 символов');

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordRepeat: z.string(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие с политикой и офертой' }) }),
  })
  .refine((v) => v.password === v.passwordRepeat, { path: ['passwordRepeat'], message: 'Пароли не совпадают' });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Введите пароль'),
  /** Код из приложения-аутентификатора, если включена 2FA */
  totp: z.string().trim().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ token: z.string().min(20), password: passwordSchema, passwordRepeat: z.string() })
  .refine((v) => v.password === v.passwordRepeat, { path: ['passwordRepeat'], message: 'Пароли не совпадают' });

export const verifyEmailSchema = z.object({ token: z.string().min(20) });

/** Принятие приглашения поставщика: установка пароля по ссылке из письма. */
export const acceptInviteSchema = z
  .object({ token: z.string().min(20), password: passwordSchema, passwordRepeat: z.string() })
  .refine((v) => v.password === v.passwordRepeat, { path: ['passwordRepeat'], message: 'Пароли не совпадают' });

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Введите 6 цифр из приложения') });
