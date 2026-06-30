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

import { isProjectActivityQueryKey, isProjectOverviewQueryKey } from '@/features/projects/queryKeys';
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
          const queryKeyHead = query.queryKey?.[0];
          Sentry.captureException(error, {
            tags: {
              source: 'react-query',
              queryKey: typeof queryKeyHead === 'string' ? queryKeyHead : 'unknown',
            },
          });
        },
      }),
      // Any successful write may have produced an audit row or shifted a
      // dashboard count/preview, so refresh the (only) mounted project-activity
      // feed AND the project-overview aggregate after every mutation — current
      // and future. The launcher cards / KPIs read solely from the overview
      // query, so this central refresh is what keeps them live without wiring
      // `projectOverviewKey` into every individual mutation's `invalidateKeys`.
      mutationCache: new MutationCache({
        onSuccess: () => {
          qc.invalidateQueries({
            predicate: (q) =>
              isProjectActivityQueryKey(q.queryKey) || isProjectOverviewQueryKey(q.queryKey),
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
