'use client';

import {
  Box, CalendarDays, ClipboardCheck, FileBadge, Glasses, Plus, ShieldCheck, User,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ComponentType, type JSX } from 'react';

import {
  Badge, Button, IconTile, MediaRow, type BadgeVariant,
} from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { UserAvatar } from '@/components/shared/UserAvatar';
import { CertificateViewerDialog } from '@/features/certificates/CertificateViewerDialog';
import {
  getCertificateExpiryState,
  type CertificateExpiryState,
} from '@/features/certificates/expiry';
import { useProjectOverview } from '@/features/projects/useProjectOverview';
import { useProjectPermissions } from '@/features/permissions';
import type { Certificate, CertificateTypeValue } from '@/lib/api/schemas';
import { formatAgo, formatDateTime, formatMonthDay } from '@/lib/formatting/dates';

import { CertificateUploadDialog } from '../CertificateUploadDialog';
import { LauncherPanel } from './LauncherPanel';

const MAX_ROWS = 4;
const ROW_HEIGHT_PX = 34;

// Mirrors the per-type icons + expiry tones used by the certificates table
// (ProjectCertificatesTable) so the previews read identically.
const TYPE_ICON: Record<CertificateTypeValue, ComponentType<{ className?: string }>> = {
  product: Box,
  installation_test: ClipboardCheck,
  inspection: Glasses,
  warranty: ShieldCheck,
  other: FileBadge,
};

const EXPIRY_BADGE: Record<CertificateExpiryState, BadgeVariant> = {
  none: 'default',
  valid: 'success',
  expiring: 'warning',
  expired: 'error',
};

export function CertificatesLauncherCard({ projectId }: { projectId: string }): JSX.Element {
  const t = useTranslations('projectDetail.tabs');
  const tExpiry = useTranslations('projectDetail.tabs.certificates.expiry');
  const locale = useLocale() as Locale;
  const { can } = useProjectPermissions(projectId);
  // Certificate preview + count come from the shared project-overview aggregate.
  const overviewQuery = useProjectOverview(projectId);
  const certsBlock = overviewQuery.data?.certificates;

  const [viewing, setViewing] = useState<Certificate | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const recent = certsBlock?.preview.slice(0, MAX_ROWS) ?? [];
  const count = certsBlock?.count ?? 0;

  const createAction = can('certificate', 'create') ? (
    <Button variant="primary" size="md" onClick={() => { setUploadOpen(true); }}>
      <Plus className="h-3.5 w-3.5" />
      {t('nav.new')}
    </Button>
  ) : undefined;

  return (
    <>
      <LauncherPanel
        icon={<FileBadge className="h-4 w-4" />}
        label={t('certificates.label')}
        count={count}
        boardHref={`/projects/${projectId}/certificates`}
        viewAllLabel={t('nav.viewAll')}
        headerAction={createAction}
        emptyLabel={t('nav.empty')}
        isLoading={overviewQuery.isLoading}
        isEmpty={recent.length === 0}
        rowHeightPx={ROW_HEIGHT_PX}
        maxRows={MAX_ROWS}
      >
        {(visible) => recent.slice(0, visible).map((c) => {
          const Icon = TYPE_ICON[c.certificate_type];
          const expiry = getCertificateExpiryState(c.valid_until);
          const createdSeconds = (Date.now() - new Date(c.created_at).getTime()) / 1000;
          const description = c.issuer ?? c.subject ?? t(`certificates.type.${c.certificate_type}`);
          return (
            <MediaRow
              key={c.id}
              className="min-h-[34px] max-h-[48px] flex-1"
              media={<IconTile tone="neutral" size="md"><Icon className="h-4 w-4" /></IconTile>}
              title={c.original_filename}
              description={description}
              trailing={(
                <div className="flex items-center gap-3 text-caption text-foreground-tertiary">
                  <span className="flex w-[68px] min-w-0 items-center gap-1">
                    {c.valid_until !== null && (
                      <>
                        <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{formatMonthDay(c.valid_until, locale)}</span>
                      </>
                    )}
                  </span>
                  <span
                    className="w-[52px] shrink-0 whitespace-nowrap text-right"
                    title={formatDateTime(c.created_at, locale)}
                  >
                    {formatAgo(createdSeconds, locale)}
                  </span>
                  <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
                  {c.uploaded_by_name !== null && c.uploaded_by_name !== '' ? (
                    <UserAvatar name={c.uploaded_by_name} size="sm" />
                  ) : (
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-foreground-tertiary"
                    >
                      <User className="h-3 w-3" />
                    </span>
                  )}
                  <Badge variant={EXPIRY_BADGE[expiry]} size="sm">
                    {tExpiry(expiry)}
                  </Badge>
                </div>
              )}
              showChevron
              onClick={() => { setViewing(c); }}
            />
          );
        })}
      </LauncherPanel>

      <CertificateViewerDialog
        certificate={viewing}
        projectId={projectId}
        open={viewing !== null}
        onOpenChange={(o) => { if (!o) setViewing(null); }}
      />
      <CertificateUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
    </>
  );
}
