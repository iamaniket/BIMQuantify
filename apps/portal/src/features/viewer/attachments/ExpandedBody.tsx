'use client';

import {
  Box,
  Download,
  Eye,
  FileText,
  Link as LinkIcon,
  MapPin,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimstitch/ui';

import {
  isWithinNetherlands,
  pdokAerialThumbnailUrl,
} from '@/features/jurisdictions/nl/mapThumbnail';
import type { Attachment } from '@/lib/api/schemas';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type MetaEntry = [string, string];

type GpsData = { latitude: number; longitude: number; altitude: number | null };
type CameraData = { make: string | null; model: string | null };
type ImageDims = { width: number | null; height: number | null };

function extractExifMeta(att: Attachment): {
  gps: GpsData | null;
  camera: CameraData | null;
  dims: ImageDims | null;
  capturedAt: string | null;
} {
  const sm = att.server_metadata;
  const cm = att.capture_metadata;

  let gps: GpsData | null = null;
  let camera: CameraData | null = null;
  let dims: ImageDims | null = null;
  let capturedAt: string | null = null;

  if (sm != null) {
    const g = sm['gps'] as Record<string, unknown> | null | undefined;
    if (g != null && typeof g['latitude'] === 'number' && typeof g['longitude'] === 'number') {
      gps = {
        latitude: g['latitude'],
        longitude: g['longitude'],
        altitude: typeof g['altitude'] === 'number' ? g['altitude'] : null,
      };
    }
    const c = sm['camera'] as Record<string, unknown> | null | undefined;
    if (c != null) {
      const make = typeof c['make'] === 'string' ? c['make'] : null;
      const model = typeof c['model'] === 'string' ? c['model'] : null;
      if (make !== null || model !== null) camera = { make, model };
    }
    const img = sm['image'] as Record<string, unknown> | null | undefined;
    if (img != null) {
      const w = typeof img['width'] === 'number' ? img['width'] : null;
      const h = typeof img['height'] === 'number' ? img['height'] : null;
      if (w !== null || h !== null) dims = { width: w, height: h };
    }
    const cap = sm['capture'] as Record<string, unknown> | null | undefined;
    if (cap != null && typeof cap['date_time_original'] === 'string') {
      capturedAt = cap['date_time_original'];
    }
  } else if (cm != null) {
    const exif = cm['exif'] as Record<string, unknown> | null | undefined;
    const geo = cm['geolocation'] as Record<string, unknown> | null | undefined;
    if (geo != null && typeof geo['latitude'] === 'number' && typeof geo['longitude'] === 'number') {
      gps = {
        latitude: geo['latitude'],
        longitude: geo['longitude'],
        altitude: typeof geo['altitude'] === 'number' ? geo['altitude'] : null,
      };
    }
    if (exif != null) {
      const make = typeof exif['make'] === 'string' ? exif['make'] : null;
      const model = typeof exif['model'] === 'string' ? exif['model'] : null;
      if (make !== null || model !== null) camera = { make, model };
      const w = typeof exif['image_width'] === 'number' ? exif['image_width'] : null;
      const h = typeof exif['image_height'] === 'number' ? exif['image_height'] : null;
      if (w !== null || h !== null) dims = { width: w, height: h };
      if (typeof exif['date_time_original'] === 'string') {
        capturedAt = exif['date_time_original'];
      }
    }
  }

  return {
    gps,
    camera,
    dims,
    capturedAt,
  };
}

function formatCoord(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lon).toFixed(6)}° ${lonDir}`;
}

type Props = {
  attachment: Attachment;
  onView: () => void;
  onLink: () => void;
  onDownload: () => void;
  onDelete: () => void;
};

export function ExpandedBody({
  attachment,
  onView,
  onLink,
  onDownload,
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

  const hasElementLink = attachment.linked_element_global_id !== null;
  const hasPdfLink = attachment.linked_point !== null
    && typeof attachment.linked_point === 'object'
    && 'page' in attachment.linked_point;
  const linkCount = (hasElementLink ? 1 : 0) + (hasPdfLink ? 1 : 0);

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
            <div className="font-mono text-[10.5px] uppercase tracking-wide leading-[1.7] text-foreground-tertiary">
              {k}
            </div>
            <div className="break-all font-mono text-xs leading-[1.7] text-foreground tabular-nums">
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
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-foreground-tertiary">
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

      {/* Linked targets */}
      <div className="border-t border-dashed border-border pt-2">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wide text-foreground-tertiary">
          <span>{t('expandedLinkedTo')}</span>
          <span className="text-foreground-secondary">{linkCount}</span>
        </div>

        {linkCount === 0 && (
          <p className="py-1.5 font-mono text-[11px] italic text-foreground-tertiary">
            {t('expandedNotLinked')}
          </p>
        )}

        {hasElementLink && (
          <div className="flex items-center gap-2 border-b border-dashed border-border py-1.5 last:border-b-0">
            <Box className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">
                {t('expandedElement')}
              </div>
              <div className="truncate font-mono text-[10.5px] text-foreground-tertiary">
                {attachment.linked_element_global_id}
              </div>
            </div>
          </div>
        )}

        {hasPdfLink && (
          <div className="flex items-center gap-2 py-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-info-hover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">
                {t('expandedPdfPage', { page: attachment.linked_point !== null ? String((attachment.linked_point as Record<string, number>)['page']) : '' })}
              </div>
              <div className="truncate font-mono text-[10.5px] text-foreground-tertiary">
                {t('expandedPdfRegion')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-1.5 flex gap-1.5 border-t border-border pt-2.5">
        <Button variant="primary" size="sm" onClick={onView}>
          <Eye className="h-3.5 w-3.5" />
          {t('expandedView')}
        </Button>
        <Button variant="border" size="sm" onClick={onLink}>
          <LinkIcon className="h-3.5 w-3.5" />
          {t('expandedLink')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDownload} title={t('expandedDownload')}>
          <Download className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onDelete} title={t('expandedRemove')} className="text-error hover:text-error">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
