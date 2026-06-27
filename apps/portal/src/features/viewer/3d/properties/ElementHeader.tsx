'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('viewer.properties');
  return <ContextLine tag={type} name={name ?? t('unnamed')} />;
}
