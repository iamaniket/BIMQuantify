'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { TokenPairSchema, type LoginRequest, type TokenPair } from '@/lib/api/schemas';

export function useLogin(): UseMutationResult<TokenPair, Error, LoginRequest> {
  return useMutation<TokenPair, Error, LoginRequest>({
    mutationFn: async (credentials) => apiClient.postForm(
      '/auth/jwt/login',
      { username: credentials.username, password: credentials.password },
      TokenPairSchema,
    ),
  });
}
