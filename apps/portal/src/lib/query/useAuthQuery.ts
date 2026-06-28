'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/errorMessages';
import { tokenManager } from '@/lib/auth/tokenManager';
import { useAuth } from '@/providers/AuthProvider';

function is401(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

type AuthQueryOptions<
  TData,
  TSelect = TData,
  TKey extends QueryKey = QueryKey,
> = Omit<UseQueryOptions<TData, Error, TSelect, TKey>, 'queryFn'> & {
  queryFn: (accessToken: string) => Promise<TData>;
};

export function useAuthQuery<
  TData,
  TSelect = TData,
  TKey extends QueryKey = QueryKey,
>(options: AuthQueryOptions<TData, TSelect, TKey>): UseQueryResult<TSelect> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  const { queryFn, enabled, ...rest } = options;

  return useQuery<TData, Error, TSelect, TKey>({
    ...rest,
    queryFn: async () => {
      // Read the LIVE token, not the render-time capture: an invalidate-driven
      // refetch right after a cross-tab org switch (#4) reuses this closure, and
      // the stale token would fetch the previous tenant's schema (#11).
      const token = tokenManager.getAccessToken(accessToken);
      if (token === null) throw new Error('Not authenticated');
      try {
        return await queryFn(token);
      } catch (error) {
        if (is401(error)) {
          const newToken = await tokenManager.refresh();
          return queryFn(newToken);
        }
        throw error;
      }
    },
    enabled: accessToken !== null && (enabled ?? true),
  } as UseQueryOptions<TData, Error, TSelect, TKey>);
}

type AuthMutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, Error, TVariables>,
  'mutationFn'
> & {
  mutationFn: (accessToken: string, variables: TVariables) => Promise<TData>;
} & Partial<{
  invalidateKeys: QueryKey[] | ((variables: TVariables, data: TData) => QueryKey[]);
  suppressToast: boolean;
}>;

export function useAuthMutation<TData, TVariables>(
  options: AuthMutationOptions<TData, TVariables>,
): UseMutationResult<TData, Error, TVariables> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  const {
    mutationFn, invalidateKeys, suppressToast, onError, ...rest
  } = options;

  return useMutation<TData, Error, TVariables>({
    ...rest,
    mutationFn: async (variables) => {
      // Read the LIVE token, not the render-time capture: a `mutateAsync` loop or
      // a mutation fired after a token change (cross-tab switch / refresh) would
      // otherwise use the stale token and write to the previous tenant (#11).
      const token = tokenManager.getAccessToken(accessToken);
      if (token === null) throw new Error('Not authenticated');
      try {
        return await mutationFn(token, variables);
      } catch (error) {
        if (is401(error)) {
          const newToken = await tokenManager.refresh();
          return mutationFn(newToken, variables);
        }
        throw error;
      }
    },
    onSuccess: async (...args) => {
      if (invalidateKeys !== undefined) {
        const keys = typeof invalidateKeys === 'function'
          ? invalidateKeys(args[1], args[0])
          : invalidateKeys;
        await Promise.all(
          keys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
        );
      }
      if (rest.onSuccess !== undefined) {
        await rest.onSuccess(...args);
      }
    },
    onError: (...args) => {
      const [error] = args;

      if (!suppressToast) {
        toast.error(getErrorMessage(error));
      }

      if (onError !== undefined) {
        onError(...args);
      }
    },
  });
}
