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
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/errorMessages';
import { useAuth } from '@/providers/AuthProvider';

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
    queryFn: () => {
      if (accessToken === null) throw new Error('Not authenticated');
      return queryFn(accessToken);
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
  const { tokens, setTokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();
  const router = useRouter();

  const {
    mutationFn, invalidateKeys, suppressToast, onError, ...rest
  } = options;

  return useMutation<TData, Error, TVariables>({
    ...rest,
    mutationFn: (variables) => {
      if (accessToken === null) throw new Error('Not authenticated');
      return mutationFn(accessToken, variables);
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

      if (error instanceof ApiError && error.status === 401) {
        setTokens(null);
        router.push('/login');
      }

      if (onError !== undefined) {
        onError(...args);
      }
    },
  });
}
