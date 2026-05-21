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
      if (accessToken === null) throw new Error('Not authenticated');
      try {
        return await queryFn(accessToken);
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
      if (accessToken === null) throw new Error('Not authenticated');
      try {
        return await mutationFn(accessToken, variables);
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
