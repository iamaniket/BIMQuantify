'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type JSX, type ReactNode } from 'react';

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
      },
    }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
