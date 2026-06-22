'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX, type ReactNode } from 'react';
import { toast } from 'sonner';

import { isProjectActivityQueryKey } from '@/features/projects/queryKeys';
import { getErrorMessage } from '@/lib/api/errorMessages';

type Props = {
  children: ReactNode;
};

export function QueryProvider({ children }: Props): JSX.Element {
  const [client] = useState(() => {
    const qc = new QueryClient({
      // Any successful write may have produced an audit row, so refresh the
      // (only) mounted project-activity feed after every mutation — current and
      // future. Independent of each mutation's own `invalidateKeys`.
      mutationCache: new MutationCache({
        onSuccess: () => {
          qc.invalidateQueries({
            predicate: (q) => isProjectActivityQueryKey(q.queryKey),
          }).catch(() => undefined);
        },
      }),
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
          staleTime: 30_000,
        },
        mutations: {
          onError: (error) => {
            toast.error(getErrorMessage(error));
          },
        },
      },
    });
    return qc;
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
