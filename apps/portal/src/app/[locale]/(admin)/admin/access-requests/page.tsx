'use client';

import { Download, Inbox, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Input,
  Select,
  Skeleton,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import { PageShell } from '@/components/shared/layout/PageShell';
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

  const crumbs = useMemo(
    () => [
      { label: t('breadcrumb.admin'), href: '/admin/organizations' as const },
      { label: t('breadcrumb.accessRequests'), href: undefined },
    ],
    [t],
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
            <div className="flex h-[130px] w-[195px] items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-primary to-primary-light shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]">
              <Inbox className="h-12 w-12 text-primary-foreground" />
            </div>
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
      <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
        <div className="relative min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
          <Input
            inputSize="sm"
            className="pl-9"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            aria-label={t('searchAria')}
          />
        </div>
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
        <div className="flex-1" />
        <Button size="sm" variant="border" className="whitespace-nowrap" onClick={() => { void handleExport(); }}>
          <Download className="mr-1 h-3.5 w-3.5" />
          {t('exportButton')}
        </Button>
      </div>

      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3">
          <div className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary after:ml-2 after:opacity-50 after:content-['·']">
            {t('panel.eyebrow')}
          </div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-body2 font-bold">{t('panel.title', { count: allRequests.length })}</h2>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <p className="text-body3 text-error">{t('loadError')}</p>
        ) : (
          <>
            <AccessRequestsTable
              requests={allRequests}
              onApprove={handleApprove}
              onReject={handleReject}
            />
            <div className="mt-3 flex items-center justify-between text-body3 text-foreground-tertiary">
              <span>{t('showing', { count: allRequests.length })}</span>
            </div>
          </>
        )}
      </div>

      <AccessRequestApproveDialog
        request={approveTarget}
        open={approveOpen}
        onOpenChange={setApproveOpen}
      />
    </PageShell>
  );
}
