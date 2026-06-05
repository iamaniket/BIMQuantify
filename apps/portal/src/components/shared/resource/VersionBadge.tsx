'use client';

import { Badge } from '@bimstitch/ui';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/**
 * The `v{n}` header badge shown when a resource has more than one version.
 * `version` is the current (highest) version number — matches the certificate
 * head's `version_number` and the latest model file's `version_number`. Renders
 * nothing for a single-version resource so callers can drop it in unconditionally.
 */
type Props = {
  version: number;
};

export function VersionBadge({ version }: Props): JSX.Element | null {
  const t = useTranslations('common.versions');
  if (version <= 1) return null;
  return (
    <Badge variant="info" size="sm" bordered>
      {t('badge', { n: version })}
    </Badge>
  );
}
