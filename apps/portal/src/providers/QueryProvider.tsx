'use client';

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
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
      // A failed query otherwise settles silently into `query.isError` (we set
      // no global `throwOnError`, so the error.tsx boundaries never see it).
      // Report it here so a page that forgot to render its `isError` branch —
      // and instead shows `data ?? []` / a 0% score — is at least observable in
      // Sentry instead of silently displaying empty/wrong data.
      queryCache: new QueryCache({
        onError: (error, query) => {
          Sentry.captureException(error, {
            tags: { source: 'react-query', queryKey: String(query.queryKey?.[0] ?? 'unknown') },
          });
        },
      }),
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
