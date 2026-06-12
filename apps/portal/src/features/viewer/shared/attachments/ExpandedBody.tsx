'use client';

import { Download, Eye, MapPin, Trash2 } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, MetaGrid } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';
import { DetailCardBody, DetailCardFooter } from '@bimstitch/ui';

import {
  extractExifMeta,
  formatCoord,
  formatDateFull,
  formatSize,
} from '@/features/attachments/attachmentMeta';
import {
  isWithinNetherlands,
  pdokAerialThumbnailUrl,
} from '@/features/jurisdictions/nl/mapThumbnail';
import type { Attachment } from '@/lib/api/schemas';

type Props = {
  attachment: Attachment;
  onView: () => void;
  onDownload: () => void;
  onDelete: () => void;
};

export function ExpandedBody({
  attachment,
  onView,
  onDownload,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('viewerAttachments');
  const locale = useLocale() as Locale;

  const entries: Array<{ label: string; value: string }> = [
    { label: t('expandedType'), value: attachment.content_type },
    { label: t('expandedSize'), value: formatSize(attachment.size_bytes) },
  ];
  if (attachment.version_number > 1) {
    entries.push({ label: t('expandedVersion'), value: `v${String(attachment.version_number)}` });
  }

  const exif = extractExifMeta(attachment);
  if (exif.gps !== null) {
    entries.push({ label: t('expandedLocation'), value: formatCoord(exif.gps.latitude, exif.gps.longitude) });
  }
  if (exif.gps !== null && exif.gps.altitude !== null) {
    entries.push({ label: t('expandedAltitude'), value: `${exif.gps.altitude.toFixed(1)} m` });
  }
  if (exif.camera !== null) {
    const parts = [exif.camera.make, exif.camera.model].filter((s): s is string => s !== null);
    entries.push({ label: t('expandedCamera'), value: parts.join(' ') });
  }
  if (exif.dims !== null) {
    const w = exif.dims.width;
    const h = exif.dims.height;
    if (w !== null && h !== null) {
      entries.push({ label: t('expandedDimensions'), value: `${String(w)} × ${String(h)}` });
    }
  }
  if (exif.capturedAt !== null) {
    entries.push({ label: t('expandedCapturedAt'), value: formatDateFull(exif.capturedAt, locale) });
  }

  // Record metadata anchored last — consistent with Findings/Certificates.
  entries.push({ label: t('expandedAdded'), value: `${formatDateFull(attachment.created_at, locale)}${attachment.uploaded_by_name !== null ? `  ·  ${attachment.uploaded_by_name}` : ''}` });
  if (attachment.updated_at !== attachment.created_at) {
    entries.push({ label: t('expandedUpdated'), value: formatDateFull(attachment.updated_at, locale) });
  }

  const showMap = exif.gps !== null && isWithinNetherlands(exif.gps.latitude, exif.gps.longitude);
  const mapUrl = showMap && exif.gps !== null
    ? pdokAerialThumbnailUrl(exif.gps.latitude, exif.gps.longitude, { width: 400, height: 200 })
    : null;

  return (
    <>
      <DetailCardBody>
        {attachment.description !== null && (
          <div className="whitespace-pre-wrap border-b border-dashed border-border py-2.5 text-body3 leading-snug text-foreground-secondary">
            {attachment.description}
          </div>
        )}

        <MetaGrid entries={entries} />

        {mapUrl !== null && (
          <div className="mb-2 overflow-hidden rounded border border-border">
            <div className="flex items-center gap-1.5 bg-surface px-2 py-1">
              <MapPin className="h-3 w-3 text-foreground-tertiary" />
              <span className="font-sans text-[10.5px] uppercase tracking-wide text-foreground-tertiary">
                {t('expandedLocation')}
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mapUrl}
              alt={t('expandedLocation')}
              className="block h-[100px] w-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </DetailCardBody>

      <DetailCardFooter className="justify-between">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="md" onClick={onView}>
            <Eye className="h-3.5 w-3.5" />
            {t('expandedView')}
          </Button>
          <Button variant="ghost" size="md" onClick={onDownload}>
            <Download className="h-3.5 w-3.5" />
            {t('expandedDownload')}
          </Button>
        </div>
        <Button variant="ghost" size="md" onClick={onDelete} className="text-error hover:text-error">
          <Trash2 className="h-3.5 w-3.5" />
          {t('expandedRemove')}
        </Button>
      </DetailCardFooter>
    </>
  );
}
