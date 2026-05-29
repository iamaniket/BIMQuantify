'use client';

import { MapPin, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';

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

type MetaEntry = [string, string];

type Props = {
  attachment: Attachment;
  onDelete: () => void;
};

export function ExpandedBody({
  attachment,
  onDelete,
}: Props): JSX.Element {
  const t = useTranslations('viewerAttachments');

  const kv: MetaEntry[] = [
    [t('expandedType'), attachment.content_type],
    [t('expandedSize'), formatSize(attachment.size_bytes)],
    [t('expandedAdded'), `${formatDateFull(attachment.created_at)}${attachment.uploaded_by_name !== null ? `  ·  ${attachment.uploaded_by_name}` : ''}`],
  ];
  if (attachment.updated_at !== attachment.created_at) {
    kv.push([t('expandedUpdated'), formatDateFull(attachment.updated_at)]);
  }
  if (attachment.version_number > 1) {
    kv.push([t('expandedVersion'), `v${String(attachment.version_number)}`]);
  }

  const exif = extractExifMeta(attachment);
  if (exif.gps !== null) {
    kv.push([t('expandedLocation'), formatCoord(exif.gps.latitude, exif.gps.longitude)]);
  }
  if (exif.gps !== null && exif.gps.altitude !== null) {
    kv.push([t('expandedAltitude'), `${exif.gps.altitude.toFixed(1)} m`]);
  }
  if (exif.camera !== null) {
    const parts = [exif.camera.make, exif.camera.model].filter((s): s is string => s !== null);
    kv.push([t('expandedCamera'), parts.join(' ')]);
  }
  if (exif.dims !== null) {
    const w = exif.dims.width;
    const h = exif.dims.height;
    if (w !== null && h !== null) {
      kv.push([t('expandedDimensions'), `${String(w)} × ${String(h)}`]);
    }
  }
  if (exif.capturedAt !== null) {
    kv.push([t('expandedCapturedAt'), formatDateFull(exif.capturedAt)]);
  }

  const showMap = exif.gps !== null && isWithinNetherlands(exif.gps.latitude, exif.gps.longitude);
  const mapUrl = showMap && exif.gps !== null
    ? pdokAerialThumbnailUrl(exif.gps.latitude, exif.gps.longitude, { width: 400, height: 200 })
    : null;

  return (
    <div className="border-t border-border bg-surface-low px-3.5 pb-3 pt-1" style={{ paddingLeft: 64 }}>
      {/* Description */}
      {attachment.description !== null && (
        <div className="border-b border-dashed border-border py-2.5 text-body3 leading-snug text-foreground-secondary">
          {attachment.description}
        </div>
      )}

      {/* Meta grid */}
      <div className="grid grid-cols-[76px_1fr] gap-x-2.5 gap-y-1 py-2">
        {kv.map(([k, v]) => (
          <div key={k} className="contents">
            <div className="font-sans text-[10.5px] uppercase tracking-wide leading-[1.7] text-foreground-tertiary">
              {k}
            </div>
            <div className="break-all font-sans text-xs leading-[1.7] text-foreground tabular-nums">
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* Map thumbnail for geotagged images */}
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

      {/* Footer actions */}
      <div className="mt-1.5 flex justify-end border-t border-border pt-2.5">
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-error hover:text-error">
          <Trash2 className="h-3.5 w-3.5" />
          {t('expandedRemove')}
        </Button>
      </div>
    </div>
  );
}
