'use client';

import { Download, Inbox } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Select,
} from '@bimdossier/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import { PageShell } from '@/components/shared/layout/PageShell';
import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { PanelHeading } from '@/components/shared/PanelHeading';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { AccessRequestApproveDialog } from '@/features/admin/access-requests/AccessRequestApproveDialog';
import { AccessRequestsTable } from '@/features/admin/access-requests/AccessRequestsTable';
import { adminAccessRequestsListKey } from '@/features/admin/access-requests/queryKeys';
import { useAccessRequests } from '@/features/admin/access-requests/useAccessRequests';
import { useRejectAccessRequest } from '@/features/admin/access-requests/useAccessRequestActions';
import { exportAccessRequests, listAccessRequestsPage } from '@/lib/api/admin';
import { useTableQuery } from '@/lib/query/useTableQuery';
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

  const reqFilters = {
    q: search === '' ? undefined : search,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };
  const reqTable = useTableQuery<AccessRequestRead, typeof reqFilters>({
    filters: reqFilters,
    queryKey: (p) => adminAccessRequestsListKey(p),
    queryFn: (token, p) => listAccessRequestsPage(token, p),
    initialSort: { key: 'created_at', dir: 'desc' },
  });

  // Hero status breakdown reads a global (unfiltered) list so the KPIs reflect
  // the whole queue, not just the current page/filter.
  const statsQuery = useAccessRequests({});
  const statsRows = statsQuery.data ?? [];

  const tBreadcrumbs = useTranslations('breadcrumbs');

  const crumbs = useMemo(
    () => [
      { label: tBreadcrumbs('adminConsole'), href: undefined },
    ],
    [tBreadcrumbs],
  );
  useHeaderCrumbsOverride(crumbs);

  const newCount = statsRows.filter((r) => r.status === 'new').length;
  const approvedCount = statsRows.filter((r) => r.status === 'approved').length;
  const rejectedCount = statsRows.filter((r) => r.status === 'rejected').length;

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
      await exportAccessRequests(accessToken, reqFilters);
    } catch {
      toast.error(t('exportError'));
    }
  }, [tokens, reqFilters, t]);

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
              value: String(reqTable.total),
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
          <Button size="md" variant="border" className="whitespace-nowrap" onClick={() => { void handleExport(); }}>
            <Download className="mr-1 h-3.5 w-3.5" />
            {t('exportButton')}
          </Button>
        }
      >
        <SearchInput placeholder={t('searchPlaceholder')} value={search} onChange={setSearch} aria-label={t('searchAria')} />
        <Select
          selectSize="md"
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

      <PanelHeading eyebrow={t('panel.eyebrow')} title={t('panel.title', { count: reqTable.total })} />

      <AccessRequestsTable
        table={reqTable}
        onApprove={handleApprove}
        onReject={handleReject}
      />
      <TablePaginationFooter
        table={reqTable}
        className="shrink-0 border-t border-border px-5 py-2.5"
      />

      <AccessRequestApproveDialog
        request={approveTarget}
        open={approveOpen}
        onOpenChange={setApproveOpen}
      />
    </PageShell>
  );
}
