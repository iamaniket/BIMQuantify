'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge, type BadgeVariant } from '@bimstitch/ui';

type Props = { status: string };

function variantFor(status: string): BadgeVariant {
  switch (status) {
    case 'active':
      return 'success';
    case 'suspended':
      return 'warning';
    case 'deleted':
      return 'error';
    case 'provisioning':
      return 'info';
    default:
      return 'default';
  }
}

export function OrgStatusBadge({ status }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.status');
  return <Badge variant={variantFor(status)}>{t(status as 'active')}</Badge>;
}
