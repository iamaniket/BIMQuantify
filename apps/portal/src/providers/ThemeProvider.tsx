'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { JSX, ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function ThemeProvider({ children }: Props): JSX.Element {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark']}
      storageKey="theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
