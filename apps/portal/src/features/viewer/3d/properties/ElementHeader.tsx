'use client';

import type { JSX } from 'react';

import { ContextLine } from '@/components/shared/viewer/shared/ContextLine';

type ElementHeaderProps = {
  name: string | null;
  type: string;
};

export function ElementHeader({
  name,
  type,
}: ElementHeaderProps): JSX.Element {
  return <ContextLine tag={type} name={name ?? 'Unnamed'} />;
}
