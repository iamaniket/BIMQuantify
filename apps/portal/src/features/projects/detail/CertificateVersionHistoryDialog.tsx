'use client';

import { Download } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@bimstitch/ui';

import { getCertificateDownloadUrl } from '@/lib/api/certificates';
import { useCertificateVersions } from '@/features/certificates/useCertificateVersions';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  projectId: string;
  // Any version id in the group; null keeps the dialog (and its query) idle.
  certificateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatDate(value: string | null): string {
  if (value === null || value === '') return '—';
  return value.slice(0, 10);
}

export function CertificateVersionHistoryDialog({
  projectId,
  certificateId,
  open,
  onOpenChange,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
  const { tokens } = useAuth();
  const versionsQuery = useCertificateVersions(projectId, open ? certificateId : null);
  const versions = versionsQuery.data ?? [];

  const handleDownload = useCallback(
    async (id: string) => {
      if (tokens === null) return;
      try {
        const resp = await getCertificateDownloadUrl(tokens.access_token, projectId, id);
        window.open(resp.download_url, '_blank');
      } catch {
        toast.error(t('downloadError'));
      }
    },
    [tokens, projectId, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('versionHistoryTitle')}</DialogTitle>
          <DialogDescription>{t('versionHistoryDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {versionsQuery.isLoading && (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          )}
          {!versionsQuery.isLoading && versions.length === 0 && (
            <p className="py-4 text-center text-body3 text-foreground-tertiary">
              {t('versionHistoryEmpty')}
            </p>
          )}
          {versions.map((version, index) => (
            <div
              key={version.id}
              className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <Badge variant={index === 0 ? 'success' : 'default'} size="sm" bordered>
                {t('versionBadge', { n: version.version_number })}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body3 font-medium text-foreground">
                  {version.original_filename}
                </div>
                <div className="font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
                  {index === 0 ? `${t('currentVersionTag')} · ` : ''}
                  {formatDate(version.created_at)}
                  {version.uploaded_by_name !== null && version.uploaded_by_name !== ''
                    ? ` · ${version.uploaded_by_name}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                title={t('download')}
                onClick={() => { void handleDownload(version.id); }}
                className="inline-grid h-7 w-7 shrink-0 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">{t('cancel')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
