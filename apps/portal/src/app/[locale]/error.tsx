'use client';

import type { JSX } from 'react';

import { RouteErrorBoundary } from '@/components/shared/RouteErrorBoundary';

type Props = { error: Error; reset: () => void };

export default function LocaleError({ error, reset }: Props): JSX.Element {
  return <RouteErrorBoundary error={error} reset={reset} scope="locale" />;
}
