'use client';

import { Paperclip } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import type { KpiItem } from '@/components/shared/layout/KpiCard';
import type { Attachment } from '@/lib/api/schemas';

import { formatSize } from './attachmentMeta';

type Props = {
  projectName: string;
  attachments: Attachment[];
};

export function ProjectAttachmentsHero({ projectName, attachments }: Props): JSX.Element {
  const t = useTranslations('attachments.hub.hero');

  const stats = useMemo(() => {
    let images = 0;
    let documents = 0;
    let bytes = 0;
    for (const a of attachments) {
      bytes += a.size_bytes;
      if (a.attachment_category === 'image') images++;
      else if (a.attachment_category === 'office') documents++;
    }
    return { total: attachments.length, images, documents, bytes };
  }, [attachments]);

  const kpis: KpiItem[] = [
    { label: t('totalLabel'), value: String(stats.total), sub: t('totalSub') },
    { label: t('imagesLabel'), value: String(stats.images), sub: t('imagesSub') },
    { label: t('documentsLabel'), value: String(stats.documents), sub: t('documentsSub') },
    { label: t('sizeLabel'), value: formatSize(stats.bytes), sub: t('sizeSub') },
  ];

  return (
    <HeroShell
      image={(
        <HeroImage>
          <Paperclip className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      )}
      title={projectName}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      subtitle={<span>{t('subtitle')}</span>}
      kpis={kpis}
    />
  );
}
