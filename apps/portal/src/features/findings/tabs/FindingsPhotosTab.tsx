'use client';

import { Image as ImageIcon } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { useAttachmentViewUrl } from '@/features/attachments/useAttachmentViewUrl';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { statusBadgeVariant } from '@/features/projects/detail/findingBadges';
import type { Finding } from '@/lib/api/schemas';

type TileProps = {
  projectId: string;
  attachmentId: string;
  onOpen: () => void;
};

function PhotoTile({ projectId, attachmentId, onOpen }: TileProps): JSX.Element {
  const viewUrlQuery = useAttachmentViewUrl(projectId, attachmentId);
  const url = viewUrlQuery.data?.download_url;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-low transition-opacity hover:opacity-80"
    >
      {url !== undefined ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </button>
  );
}

type Props = {
  projectId: string;
  findings: Finding[];
};

export function FindingsPhotosTab({ projectId, findings }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.photos');
  const tStatus = useTranslations('findingsBoard.columns');
  const [selected, setSelected] = useState<Finding | null>(null);

  // Findings that carry any imagery (initial photos or resolution evidence).
  const withPhotos = useMemo(
    () => findings
      .map((f) => ({
        finding: f,
        ids: [...(f.photo_ids ?? []), ...(f.resolution_evidence_ids ?? [])],
      }))
      .filter((entry) => entry.ids.length > 0),
    [findings],
  );

  if (withPhotos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <ImageIcon className="h-8 w-8 text-foreground-tertiary" aria-hidden />
        <p className="text-body3 text-foreground-tertiary">{t('empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {withPhotos.map(({ finding, ids }) => (
        <div key={finding.id} className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { setSelected(finding); }}
            className="flex items-center gap-2 text-left"
          >
            <span className="truncate text-body3 font-semibold text-foreground">{finding.title}</span>
            <Badge variant={statusBadgeVariant(finding.status)} size="md">
              {tStatus(finding.status)}
            </Badge>
            <span className="text-[11px] tabular-nums text-foreground-tertiary">
              {t('count', { count: ids.length })}
            </span>
          </button>
          <div className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <PhotoTile
                key={id}
                projectId={projectId}
                attachmentId={id}
                onOpen={() => { setSelected(finding); }}
              />
            ))}
          </div>
        </div>
      ))}

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
