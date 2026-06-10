'use client';

import { BookOpen, Building2, ChevronRight, Download, Inbox, LayoutGrid, Plus, Table2, Users } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Select,
  Skeleton,
  TabsContent,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { PageTableContent, SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { AccessRequestApproveDialog } from '@/features/admin/access-requests/AccessRequestApproveDialog';
import { AccessRequestsTable } from '@/features/admin/access-requests/AccessRequestsTable';
import { useAccessRequests } from '@/features/admin/access-requests/useAccessRequests';
import { useRejectAccessRequest } from '@/features/admin/access-requests/useAccessRequestActions';
import { BlogPostCreateDialog } from '@/features/admin/blog/BlogPostCreateDialog';
import { BlogPostsTable } from '@/features/admin/blog/BlogPostsTable';
import { useAdminBlogPosts } from '@/features/admin/blog/useAdminBlogPosts';
import { useDeleteBlogPost } from '@/features/admin/blog/useDeleteBlogPost';
import { useUpdateBlogPost } from '@/features/admin/blog/useUpdateBlogPost';
import { OrgCreateDialog } from '@/features/admin/organizations/OrgCreateDialog';
import { OrgTable } from '@/features/admin/organizations/OrgTable';
import { useAdminOrganizations } from '@/features/admin/organizations/useAdminOrganizations';
import { exportAccessRequests } from '@/lib/api/admin';
import type {
  AccessRequestRead,
  BlogPostRead,
  OrganizationRead,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';


// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function AdminOrgsHero({
  organizations,
  pendingRequests,
}: {
  organizations: OrganizationRead[];
  pendingRequests: number;
}): JSX.Element {
  const t = useTranslations('admin.organizations.hero');

  const total = organizations.length;
  const activeCount = organizations.filter((o) => o.status === 'active').length;
  const totalSeats = organizations.reduce((sum, o) => sum + o.seat_count_used, 0);

  return (
    <HeroShell
      image={
        <HeroImage>
          <Building2 className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      }
      title={t('title')}
      badge={
        <Badge variant="info">{t('badge')}</Badge>
      }
      subtitle={
        <span>{t('subtitle')}</span>
      }
      kpis={[
        {
          label: t('totalLabel'),
          value: String(total),
          sub: t('totalSub'),
        },
        {
          label: t('activeLabel'),
          value: String(activeCount),
          color: 'var(--success)',
          sub: t('activeSub'),
        },
        {
          label: t('seatsLabel'),
          value: String(totalSeats),
          sub: t('seatsSub'),
        },
        {
          label: t('pendingRequestsLabel'),
          value: String(pendingRequests),
          ...(pendingRequests > 0 && { color: 'var(--primary)' }),
          sub: t('pendingRequestsSub'),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewPane({
  organizations,
  onCreateTenant,
}: {
  organizations: OrganizationRead[];
  onCreateTenant: () => void;
}): JSX.Element {
  const t = useTranslations('admin.organizations.overview');

  const byStatus = {
    active: organizations.filter((o) => o.status === 'active'),
    suspended: organizations.filter((o) => o.status === 'suspended'),
    provisioning: organizations.filter((o) => o.status === 'provisioning'),
  };

  const totalSeats = organizations.reduce((sum, o) => sum + o.seat_count_used, 0);
  const totalCapacity = organizations.reduce((sum, o) => sum + (o.seat_limit ?? 0), 0);
  const unlimitedCount = organizations.filter((o) => o.seat_limit === null).length;

  const totalStorageUsed = organizations.reduce((sum, o) => sum + o.active_storage_used_gb, 0);
  const totalStorageCap = organizations.reduce((sum, o) => sum + (o.active_storage_limit_gb ?? 0), 0);
  const unlimitedStorageCount = organizations.filter((o) => o.active_storage_limit_gb === null).length;

  const avgMembers = organizations.length > 0
    ? (totalSeats / organizations.length).toFixed(1)
    : '0';

  const recentOrgs = [...organizations]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {/* Tenants by status */}
      <div className="rounded-lg border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('byStatusTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
              <span className="h-2.5 w-2.5 rounded-sm bg-success" />
              {t('statusActive')}
            </div>
            <span className="font-sans text-body3 text-foreground-tertiary">{byStatus.active.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
              {t('statusSuspended')}
            </div>
            <span className="font-sans text-body3 text-foreground-tertiary">{byStatus.suspended.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
              <span className="h-2.5 w-2.5 rounded-sm bg-foreground-tertiary" />
              {t('statusProvisioning')}
            </div>
            <span className="font-sans text-body3 text-foreground-tertiary">{byStatus.provisioning.length}</span>
          </div>
        </div>
      </div>

      {/* Seat allocation */}
      <div className="rounded-lg border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('seatAllocationTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('seatsInUse')}</span>
            <span className="font-sans text-body3 font-semibold">{totalSeats}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('totalCapacity')}</span>
            <span className="font-sans text-body3 text-foreground-tertiary">
              {totalCapacity}{unlimitedCount > 0 ? ` + ${unlimitedCount} ∞` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Members across tenants */}
      <div className="rounded-lg border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('memberStatsTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('totalMembers')}</span>
            <span className="font-sans text-body3 font-semibold">{totalSeats}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('averagePerTenant')}</span>
            <span className="font-sans text-body3 text-foreground-tertiary">{avgMembers}</span>
          </div>
        </div>
      </div>

      {/* Storage usage */}
      <div className="rounded-lg border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('storageStatsTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('totalStorageUsed')}</span>
            <span className="font-sans text-body3 font-semibold">{t('storageGb', { value: totalStorageUsed.toFixed(1) })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('totalStorageCapacity')}</span>
            <span className="font-sans text-body3 text-foreground-tertiary">
              {t('storageGb', { value: String(totalStorageCap) })}{unlimitedStorageCount > 0 ? ` + ${t('unlimitedStorage', { count: unlimitedStorageCount })}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Recently created */}
      <div className="rounded-lg border border-border bg-surface-low p-5 xl:col-span-2">
        <h3 className="mb-4 text-body2 font-bold">{t('recentTitle')}</h3>
        {recentOrgs.length === 0 ? (
          <p className="text-body3 text-foreground-tertiary">{t('noTenants')}</p>
        ) : (
          <div className="divide-y divide-border">
            {recentOrgs.map((org) => (
              <div key={org.id} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-body3 font-medium">{org.name}</span>
                  <span className="ml-2 font-sans text-caption text-foreground-tertiary">{org.schema_name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={org.status === 'active' ? 'success' : org.status === 'suspended' ? 'warning' : 'default'}>
                    {org.status}
                  </Badge>
                  <span className="text-caption text-foreground-tertiary">
                    {new Date(org.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="rounded-lg border border-border bg-surface-low p-5 xl:col-span-2">
        <h3 className="mb-3 text-body2 font-bold">{t('quickActionsTitle')}</h3>
        <div className="space-y-0.5">
          <button
            type="button"
            className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
            onClick={onCreateTenant}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <div className="text-body3 font-semibold">{t('createTenant')}</div>
              <div className="text-caption text-foreground-tertiary">{t('createTenantDesc')}</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
          </button>
          <button
            type="button"
            className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-primary-light hover:bg-primary-lighter"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-lighter text-primary">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <div className="text-body3 font-semibold">{t('exportPlatformData')}</div>
              <div className="text-caption text-foreground-tertiary">{t('exportPlatformDataDesc')}</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-foreground-tertiary" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminOrganizationsPage(): JSX.Element {
  const t = useTranslations('admin.organizations');
  const tReq = useTranslations('admin.accessRequests');
  const tBlog = useTranslations('admin.blog');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<AccessRequestRead | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [tab, setTab] = useState('overview');

  // Access-request state
  const [reqSearch, setReqSearch] = useState('');
  const [reqStatusFilter, setReqStatusFilter] = useState<string>('all');

  // Blog state
  const [blogLocale, setBlogLocale] = useState<string>('all');
  const [blogStatus, setBlogStatus] = useState<string>('all');
  const [blogCreateOpen, setBlogCreateOpen] = useState(false);
  const [blogDeletingId, setBlogDeletingId] = useState<string | null>(null);
  const [blogTogglingId, setBlogTogglingId] = useState<string | null>(null);

  const { tokens } = useAuth();
  const rejectMutation = useRejectAccessRequest();

  const params = {
    q: search === '' ? undefined : search,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };
  const query = useAdminOrganizations(params);
  const allOrgs = query.data ?? [];

  const reqParams = {
    q: reqSearch === '' ? undefined : reqSearch,
    status: reqStatusFilter === 'all' ? undefined : reqStatusFilter,
  };
  const reqQuery = useAccessRequests(reqParams);
  const allRequests = reqQuery.data ?? [];
  const pendingRequestCount = allRequests.filter((r) => r.status === 'new').length;

  const blogParams = {
    locale: blogLocale === 'all' ? undefined : (blogLocale as 'en' | 'nl'),
    status: blogStatus === 'all' ? undefined : (blogStatus as 'draft' | 'published'),
  };
  const blogQuery = useAdminBlogPosts(blogParams);
  const blogPosts = blogQuery.data ?? [];
  const deleteBlogMutation = useDeleteBlogPost();
  const updateBlogMutation = useUpdateBlogPost();

  const handleBlogToggleStatus = useCallback((post: BlogPostRead) => {
    const nextStatus = post.status === 'published' ? 'draft' : 'published';
    setBlogTogglingId(post.id);
    updateBlogMutation.mutate(
      { id: post.id, input: { status: nextStatus } },
      {
        onSuccess: () => {
          toast.success(
            nextStatus === 'published'
              ? tBlog('toast.published')
              : tBlog('toast.unpublished'),
          );
        },
        onError: () => {
          toast.error(tBlog('toast.statusError'));
        },
        onSettled: () => {
          setBlogTogglingId(null);
        },
      },
    );
  }, [updateBlogMutation, tBlog]);

  const handleBlogDelete = useCallback((post: BlogPostRead) => {
    if (typeof window === 'undefined') return;
    const ok = window.confirm(tBlog('confirmDelete', { title: post.title }));
    if (!ok) return;
    setBlogDeletingId(post.id);
    deleteBlogMutation.mutate(
      { id: post.id },
      {
        onSuccess: () => {
          toast.success(tBlog('toast.deleted'));
        },
        onError: () => {
          toast.error(tBlog('toast.deleteError'));
        },
        onSettled: () => {
          setBlogDeletingId(null);
        },
      },
    );
  }, [deleteBlogMutation, tBlog]);

  const tBreadcrumbs = useTranslations('breadcrumbs');

  const crumbs = useMemo(
    () => [
      { label: tBreadcrumbs('adminConsole'), href: undefined },
    ],
    [tBreadcrumbs],
  );
  useHeaderCrumbsOverride(crumbs);

  const handleApprove = useCallback((req: AccessRequestRead) => {
    // Approving an access request must go through the dedicated dialog +
    // /admin/access-requests/{id}/approve endpoint, which atomically
    // provisions the org AND flips the AR status in one transaction.
    //
    // The earlier flow opened OrgCreateDialog (which POSTs /admin/organizations
    // to create the org) and THEN posted to /approve afterwards — the second
    // call would always 409 with ORG_NAME_TAKEN because the first call had
    // already created an org with that name. The AR would be stranded at `new`
    // forever.
    setApproveTarget(req);
    setApproveOpen(true);
  }, []);

  const handleReject = useCallback((req: AccessRequestRead) => {
    rejectMutation.mutate(
      { id: req.id },
      { onSuccess: () => { toast.success(tReq('rejectSuccess')); } },
    );
  }, [rejectMutation, tReq]);

  const handleExport = useCallback(async () => {
    const accessToken = tokens?.access_token;
    if (accessToken === undefined) return;
    try {
      await exportAccessRequests(accessToken, reqParams);
    } catch {
      toast.error(tReq('exportError'));
    }
  }, [tokens, reqParams, tReq]);

  const panelHeading = {
    organizations: {
      eyebrow: t('panel.orgsEyebrow'),
      title: t('panel.orgsTitle', { count: allOrgs.length }),
      sub: '',
    },
    overview: {
      eyebrow: t('panel.overviewEyebrow'),
      title: t('panel.overviewTitle'),
      sub: '',
    },
    requests: {
      eyebrow: t('panel.requestsEyebrow'),
      title: t('panel.requestsTitle', { count: allRequests.length }),
      sub: '',
    },
    blog: {
      eyebrow: tBlog('panel.eyebrow'),
      title: tBlog('panel.title', { count: blogPosts.length }),
      sub: '',
    },
  }[tab] ?? { eyebrow: '', title: '', sub: '' };

  const toolbar = tab === 'organizations' ? (
    <TableToolbar
      actions={
        <Button size="md" className="whitespace-nowrap" onClick={() => { setCreateOpen(true); }}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('createButton')}
        </Button>
      }
    >
      <SearchInput placeholder={t('searchPlaceholder')} value={search} onChange={setSearch} aria-label={t('searchAria')} />
      <Select selectsize="md" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }} aria-label={t('statusFilterAria')}>
        <option value="all">{t('statusFilters.all')}</option>
        <option value="active">{t('statusFilters.active')}</option>
        <option value="suspended">{t('statusFilters.suspended')}</option>
        <option value="provisioning">{t('statusFilters.provisioning')}</option>
      </Select>
    </TableToolbar>
  ) : tab === 'blog' ? (
    <TableToolbar
      actions={
        <Button size="md" className="whitespace-nowrap" onClick={() => { setBlogCreateOpen(true); }}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {tBlog('createButton')}
        </Button>
      }
    >
      <Select selectsize="md" value={blogLocale} onChange={(e) => { setBlogLocale(e.target.value); }} aria-label={tBlog('localeFilterAria')}>
        <option value="all">{tBlog('localeFilters.all')}</option>
        <option value="en">EN</option>
        <option value="nl">NL</option>
      </Select>
      <Select selectsize="md" value={blogStatus} onChange={(e) => { setBlogStatus(e.target.value); }} aria-label={tBlog('statusFilterAria')}>
        <option value="all">{tBlog('statusFilters.all')}</option>
        <option value="published">{tBlog('statusFilters.published')}</option>
        <option value="draft">{tBlog('statusFilters.draft')}</option>
      </Select>
    </TableToolbar>
  ) : tab === 'requests' ? (
    <TableToolbar
      actions={
        <Button size="md" variant="border" className="whitespace-nowrap" onClick={() => { void handleExport(); }}>
          <Download className="mr-1 h-3.5 w-3.5" />
          {tReq('exportButton')}
        </Button>
      }
    >
      <SearchInput placeholder={tReq('searchPlaceholder')} value={reqSearch} onChange={setReqSearch} aria-label={tReq('searchAria')} />
      <Select selectsize="md" value={reqStatusFilter} onChange={(e) => { setReqStatusFilter(e.target.value); }} aria-label={tReq('statusFilterAria')}>
        <option value="all">{tReq('statusFilters.all')}</option>
        <option value="new">{tReq('statusFilters.new')}</option>
        <option value="approved">{tReq('statusFilters.approved')}</option>
        <option value="rejected">{tReq('statusFilters.rejected')}</option>
      </Select>
    </TableToolbar>
  ) : undefined;

  return (
    <TabbedPageShell
      hero={<AdminOrgsHero organizations={allOrgs} pendingRequests={pendingRequestCount} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        { value: 'organizations', label: t('tabs.organizations'), icon: <Table2 className="h-4 w-4" />, badge: <Badge variant="primary" size="md" bordered={false}>{allOrgs.length}</Badge> },
        { value: 'requests', label: t('tabs.requests'), icon: <Inbox className="h-4 w-4" />, badge: pendingRequestCount > 0 ? <Badge variant="primary" size="md" bordered={false}>{pendingRequestCount}</Badge> : undefined },
        { value: 'blog', label: tBlog('tab'), icon: <BookOpen className="h-4 w-4" />, badge: <Badge variant="default" size="md" bordered={false}>{blogPosts.length}</Badge> },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      toolbar={toolbar}
      afterTabs={
        <>
          <OrgCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
          <AccessRequestApproveDialog request={approveTarget} open={approveOpen} onOpenChange={setApproveOpen} />
          <BlogPostCreateDialog open={blogCreateOpen} onOpenChange={setBlogCreateOpen} />
        </>
      }
    >
      <TabsContent value="organizations" className="mt-0">
        <PageTableContent isLoading={query.isLoading} isError={query.isError} errorMessage={t('loadError')} countLabel={t('showing', { count: allOrgs.length })}>
          <OrgTable organizations={allOrgs} />
        </PageTableContent>
      </TabsContent>

      <TabsContent value="overview" className="mt-0">
        {query.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <OverviewPane organizations={allOrgs} onCreateTenant={() => { setCreateOpen(true); }} />
        )}
      </TabsContent>

      <TabsContent value="blog" className="mt-0">
        <PageTableContent isLoading={blogQuery.isLoading} isError={blogQuery.isError} errorMessage={tBlog('loadError')}>
          <BlogPostsTable
            posts={blogPosts}
            onDelete={handleBlogDelete}
            onToggleStatus={handleBlogToggleStatus}
            deletingId={blogDeletingId}
            togglingId={blogTogglingId}
          />
        </PageTableContent>
      </TabsContent>

      <TabsContent value="requests" className="mt-0">
        <PageTableContent isLoading={reqQuery.isLoading} isError={reqQuery.isError} errorMessage={tReq('loadError')} countLabel={tReq('showing', { count: allRequests.length })}>
          <AccessRequestsTable
            requests={allRequests}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </PageTableContent>
      </TabsContent>
    </TabbedPageShell>
  );
}
