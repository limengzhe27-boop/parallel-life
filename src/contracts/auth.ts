import { z } from 'zod';
import { Id } from './api.ts';

export const IdentifierSchema = z
  .string()
  .trim()
  .min(3, '账号长度至少 3 个字符')
  .max(64, '账号长度最多 64 个字符')
  .regex(/^[a-zA-Z0-9_@.-]+$/, '账号仅支持字母、数字、下划线及 @ . -');

export const PasswordSchema = z
  .string()
  .min(8, '密码长度至少 8 位')
  .max(100, '密码长度最多 100 位');

export const RegisterRequestSchema = z.strictObject({
  identifier: IdentifierSchema,
  password: PasswordSchema,
  mergeGuest: z.boolean().optional().default(false),
});
export type RegisterRequest = z.input<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.strictObject({
  identifier: IdentifierSchema,
  password: PasswordSchema,
  mergeGuest: z.boolean().optional().default(false),
});
export type LoginRequest = z.input<typeof LoginRequestSchema>;

export const AuthResultSchema = z.strictObject({
  accountId: Id,
  identifier: z.string(),
  kind: z.literal('account'),
  mergedGuest: z.boolean(),
  csrfToken: z.string(),
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

export const SessionStatusSchema = z.strictObject({
  authenticated: z.boolean(),
  kind: z.enum(['guest', 'account']),
  userId: Id,
  identifier: z.string().nullable(),
  csrfToken: z.string(),
});
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
