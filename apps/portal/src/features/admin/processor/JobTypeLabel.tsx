'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { JobType } from '@/lib/api/schemas/jobs';

/** Human-readable job type, localized via `admin.processor.jobType.*`. */
export function JobTypeLabel({ type }: { type: JobType }): JSX.Element {
  const t = useTranslations('admin.processor.jobType');
  return <span className="text-body3 text-foreground">{t(type)}</span>;
}
