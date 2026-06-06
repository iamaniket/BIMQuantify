'use client';

import { Download, Inbox } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Select,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import { PageShell } from '@/components/shared/layout/PageShell';
import { PageTableContent, SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { PanelHeading } from '@/components/shared/PanelHeading';
import { AccessRequestApproveDialog } from '@/features/admin/access-requests/AccessRequestApproveDialog';
import { AccessRequestsTable } from '@/features/admin/access-requests/AccessRequestsTable';
import { useAccessRequests } from '@/features/admin/access-requests/useAccessRequests';
import { useRejectAccessRequest } from '@/features/admin/access-requests/useAccessRequestActions';
import { exportAccessRequests } from '@/lib/api/admin';
import type { AccessRequestRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

export default function AdminAccessRequestsPage(): JSX.Element {
  const t = useTranslations('admin.accessRequests');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [approveTarget, setApproveTarget] = useState<AccessRequestRead | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);

  const { tokens } = useAuth();
  const rejectMutation = useRejectAccessRequest();

  const params = {
    q: search === '' ? undefined : search,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };
  const query = useAccessRequests(params);
  const allRequests = query.data ?? [];

  const tBreadcrumbs = useTranslations('breadcrumbs');

  const crumbs = useMemo(
    () => [
      { label: tBreadcrumbs('adminConsole'), href: undefined },
    ],
    [tBreadcrumbs],
  );
  useHeaderCrumbsOverride(crumbs);

  const newCount = allRequests.filter((r) => r.status === 'new').length;
  const approvedCount = allRequests.filter((r) => r.status === 'approved').length;
  const rejectedCount = allRequests.filter((r) => r.status === 'rejected').length;

  const handleApprove = useCallback((req: AccessRequestRead) => {
    setApproveTarget(req);
    setApproveOpen(true);
  }, []);

  const handleReject = useCallback((req: AccessRequestRead) => {
    rejectMutation.mutate(
      { id: req.id },
      {
        onSuccess: () => { toast.success(t('rejectSuccess')); },
      },
    );
  }, [rejectMutation, t]);

  const handleExport = useCallback(async () => {
    const accessToken = tokens?.access_token;
    if (accessToken === undefined) return;
    try {
      await exportAccessRequests(accessToken, params);
    } catch {
      toast.error(t('exportError'));
    }
  }, [tokens, params, t]);

  return (
    <PageShell
      hero={
        <HeroShell
          image={
            <HeroImage>
              <Inbox className="h-12 w-12 text-primary-foreground" />
            </HeroImage>
          }
          title={t('hero.title')}
          badge={<Badge variant="info">{t('hero.badge')}</Badge>}
          subtitle={<span>{t('hero.subtitle')}</span>}
          kpis={[
            {
              label: t('hero.totalLabel'),
              value: String(allRequests.length),
              sub: t('hero.totalSub'),
            },
            {
              label: t('hero.newLabel'),
              value: String(newCount),
              ...(newCount > 0 && { color: 'var(--primary)' }),
              sub: t('hero.newSub'),
            },
            {
              label: t('hero.approvedLabel'),
              value: String(approvedCount),
              color: 'var(--success)',
              sub: t('hero.approvedSub'),
            },
            {
              label: t('hero.rejectedLabel'),
              value: String(rejectedCount),
              sub: t('hero.rejectedSub'),
            },
          ]}
        />
      }
    >
      {/* Toolbar */}
      <TableToolbar
        actions={
          <Button size="sm" variant="border" className="whitespace-nowrap" onClick={() => { void handleExport(); }}>
            <Download className="mr-1 h-3.5 w-3.5" />
            {t('exportButton')}
          </Button>
        }
      >
        <SearchInput placeholder={t('searchPlaceholder')} value={search} onChange={setSearch} aria-label={t('searchAria')} />
        <Select
          selectSize="sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); }}
          aria-label={t('statusFilterAria')}
        >
          <option value="all">{t('statusFilters.all')}</option>
          <option value="new">{t('statusFilters.new')}</option>
          <option value="approved">{t('statusFilters.approved')}</option>
          <option value="rejected">{t('statusFilters.rejected')}</option>
        </Select>
      </TableToolbar>

      <PanelHeading eyebrow={t('panel.eyebrow')} title={t('panel.title', { count: allRequests.length })} />

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <PageTableContent isLoading={query.isLoading} isError={query.isError} errorMessage={t('loadError')} countLabel={t('showing', { count: allRequests.length })}>
          <AccessRequestsTable
            requests={allRequests}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </PageTableContent>
      </div>

      <AccessRequestApproveDialog
        request={approveTarget}
        open={approveOpen}
        onOpenChange={setApproveOpen}
      />
    </PageShell>
  );
}
