'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX, type ReactNode } from 'react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/api/errorMessages';

type Props = {
  children: ReactNode;
};

export function QueryProvider({ children }: Props): JSX.Element {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
        },
        mutations: {
          onError: (error) => {
            toast.error(getErrorMessage(error));
          },
        },
      },
    }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
