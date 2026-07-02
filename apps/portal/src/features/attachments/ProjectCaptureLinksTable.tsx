'use client';

import { Copy, LinkIcon, XCircle } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import { formatDate } from '@/lib/formatting/dates';
import type { TablePagination } from '@/lib/query/useTableQuery';
import type { CaptureLink } from '@/lib/api/schemas';

type Props = {
  table: TablePagination<CaptureLink>;
  canRevoke: boolean;
  onCopy: (link: CaptureLink) => void;
  onRevoke: (link: CaptureLink) => void;
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

const actionBtn =
  'inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground';

export function ProjectCaptureLinksTable({
  table,
  canRevoke,
  onCopy,
  onRevoke,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.attachments');
  const locale = useLocale() as Locale;

  const columns: Column<CaptureLink>[] = [
    {
      header: t('captureLinkColLabel'),
      sortKey: 'label',
      cell: (link) => (
        <div className="flex items-center gap-2.5">
          <LinkIcon className="h-5 w-5 shrink-0 text-foreground-secondary" />
          <span className="min-w-0 truncate font-medium text-foreground">
            {link.label ?? `Link ${link.id.slice(0, 8)}`}
          </span>
        </div>
      ),
    },
    {
      header: t('captureLinkColUses'),
      sortKey: 'use_count',
      className: 'text-foreground-secondary tabular-nums',
      cell: (link) =>
        link.max_uses !== null
          ? t('captureLinkUses', { count: link.use_count, max: link.max_uses })
          : t('captureLinkUsesUnlimited', { count: link.use_count }),
    },
    {
      header: t('captureLinkColStatus'),
      cell: (link) => {
        if (isRevoked(link)) {
          return <Badge variant="error" size="md" bordered>{t('captureLinkRevokedBadge')}</Badge>;
        }
        if (isExpired(link)) {
          return <Badge variant="warning" size="md" bordered>{t('captureLinkExpired')}</Badge>;
        }
        if (isExhausted(link)) {
          return <Badge variant="default" size="md" bordered>{t('captureLinkExhausted')}</Badge>;
        }
        return <Badge variant="success" size="md" bordered>{t('captureLinkStatusActive')}</Badge>;
      },
    },
    {
      header: t('captureLinkColExpires'),
      sortKey: 'expires_at',
      className: 'text-foreground-tertiary tabular-nums',
      cell: (link) => formatDate(link.expires_at, locale),
    },
    {
      header: t('captureLinkColCreated'),
      sortKey: 'created_at',
      className: 'text-foreground-tertiary tabular-nums',
      cell: (link) => formatDate(link.created_at, locale),
    },
    {
      header: '',
      headerClassName: 'text-right',
      cell: (link) => {
        const active = !isExpired(link) && !isRevoked(link) && !isExhausted(link);
        if (!active) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {link.url !== null && (
              <button type="button" title={t('captureLinkCopy')} onClick={() => { onCopy(link); }} className={actionBtn}>
                <Copy className="h-4 w-4" />
              </button>
            )}
            {canRevoke && (
              <button
                type="button"
                title={t('captureLinkRevoke')}
                onClick={() => { onRevoke(link); }}
                className="inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-error"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      rowKey={(l) => l.id}
      emptyMessage={t('captureLinkNoLinks')}
      sort={table.sort}
      onToggleSort={table.toggleSort}
      isLoading={table.isLoading}
      isFetching={table.isFetching}
      isError={table.isError}
      errorMessage={t('captureLinkLoadError')}
      rowClassName="hover:bg-background-hover"
    />
  );
}
