'use client';

import { LinkIcon, XCircle } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';
import { toast } from 'sonner';

import { Button, Skeleton } from '@bimstitch/ui';

import type { CaptureLink } from '@/lib/api/schemas';

import { useCaptureLinks } from './useCaptureLinks';
import { useRevokeCaptureLink } from './useRevokeCaptureLink';

type Props = {
  projectId: string;
};

function isExpired(link: CaptureLink): boolean {
  return new Date(link.expires_at) < new Date();
}

function isRevoked(link: CaptureLink): boolean {
  return link.revoked_at !== null;
}

function isExhausted(link: CaptureLink): boolean {
  return link.max_uses !== null && link.use_count >= link.max_uses;
}

export function CaptureLinksList({ projectId }: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const linksQuery = useCaptureLinks(projectId);
  const revokeMutation = useRevokeCaptureLink(projectId);

  const handleRevoke = useCallback(
    (linkId: string) => {
      revokeMutation.mutate(linkId, {
        onSuccess: () => { toast.success(t('captureLinkRevoked')); },
      });
    },
    [revokeMutation, t],
  );

  if (linksQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const links = linksQuery.data ?? [];

  if (links.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
        <LinkIcon className="mx-auto mb-1.5 h-5 w-5 text-foreground-tertiary" />
        <div className="text-caption text-foreground-tertiary">{t('captureLinkNoLinks')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {links.map((link) => {
        const expired = isExpired(link);
        const revoked = isRevoked(link);
        const exhausted = isExhausted(link);
        const active = !expired && !revoked && !exhausted;

        return (
          <div
            key={link.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
              active ? 'border-border bg-background' : 'border-border/50 bg-background-secondary opacity-60'
            }`}
          >
            <LinkIcon className="h-4 w-4 shrink-0 text-foreground-tertiary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body3 font-medium">
                {link.label ?? `Link ${link.id.slice(0, 8)}`}
              </div>
              <div className="flex items-center gap-2 text-caption text-foreground-tertiary">
                {link.max_uses !== null
                  ? t('captureLinkUses', { count: link.use_count, max: link.max_uses })
                  : t('captureLinkUsesUnlimited', { count: link.use_count })}
                {revoked && (
                  <>
                    <span className="opacity-40">&middot;</span>
                    <span className="text-destructive">{t('captureLinkRevokedBadge')}</span>
                  </>
                )}
                {expired && !revoked && (
                  <>
                    <span className="opacity-40">&middot;</span>
                    <span className="text-warning">{t('captureLinkExpired')}</span>
                  </>
                )}
              </div>
            </div>
            {active && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => { handleRevoke(link.id); }}
                disabled={revokeMutation.isPending}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" />
                {t('captureLinkRevoke')}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
