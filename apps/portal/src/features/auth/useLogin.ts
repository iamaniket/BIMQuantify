'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import { apiClient } from '@/lib/api/client';
import { TokenPairSchema, type LoginRequest, type TokenPair } from '@/lib/api/schemas';

export function useLogin(): UseMutationResult<TokenPair, Error, LoginRequest> {
  return useMutation<TokenPair, Error, LoginRequest>({
    mutationFn: async (credentials) => apiClient.postForm(
      '/auth/jwt/login',
      { username: credentials.username, password: credentials.password },
      TokenPairSchema,
    ),
    onSuccess: () => {
      track(PORTAL_EVENTS.SIGNED_IN);
    },
    // LoginForm displays errors inline — suppress the QueryClient default toast.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onError: () => {},
  });
}
