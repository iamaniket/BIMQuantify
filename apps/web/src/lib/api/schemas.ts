import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenPairSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().min(1),
});

export type TokenPair = z.infer<typeof TokenPairSchema>;

export const UserReadSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  is_verified: z.boolean(),
  full_name: z.union([z.string(), z.null()]),
  organization_id: z.union([z.string(), z.null()]),
});

export type UserRead = z.infer<typeof UserReadSchema>;

export const ApiErrorBodySchema = z.object({
  detail: z.union([z.string(), z.array(z.unknown()), z.record(z.unknown())]),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
