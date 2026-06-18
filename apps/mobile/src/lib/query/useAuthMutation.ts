import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';
import { tokenManager } from '@/lib/api/tokenManager';
import { useAuth } from '@/providers/AuthProvider';

type AuthMutationOptions = {
  invalidateKeys?: readonly (readonly unknown[])[];
};

/**
 * Authed mutation helper mirroring useAuthQuery: runs `fn` with the current
 * access token and retries once on 401 via tokenManager.refresh().
 */
export function useAuthMutation<TData, TVariables>(
  fn: (accessToken: string, variables: TVariables) => Promise<TData>,
  options?: AuthMutationOptions,
): UseMutationResult<TData, Error, TVariables> {
  const { tokens } = useAuth();
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const accessToken = tokens?.access_token ?? null;
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      try {
        return await fn(accessToken, variables);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const fresh = await tokenManager.refresh();
          return fn(fresh, variables);
        }
        throw error;
      }
    },
    onSuccess: async () => {
      if (options?.invalidateKeys) {
        await Promise.all(
          options.invalidateKeys.map((key) =>
            queryClient.invalidateQueries({ queryKey: [...key] }),
          ),
        );
      }
    },
  });
}
