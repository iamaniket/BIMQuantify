'use client';

import {
  Building2,
  LayoutGrid,
  Plus,
  Search,
  Table2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import {
  Badge,
  Button,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';
import { HeroShell } from '@/components/layout/HeroShell';
import { PageShell } from '@/components/layout/PageShell';
import { OrgCreateDialog } from '@/features/admin/organizations/OrgCreateDialog';
import { OrgTable } from '@/features/admin/organizations/OrgTable';
import { useAdminOrganizations } from '@/features/admin/organizations/useAdminOrganizations';
import type { OrganizationRead } from '@/lib/api/schemas';

const TAB_CLASS =
  'relative gap-2 rounded-none bg-transparent px-4 py-3 text-body3 font-medium text-foreground-tertiary shadow-none transition-colors hover:text-foreground-secondary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary';

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function AdminOrgsHero({
  organizations,
}: {
  organizations: OrganizationRead[];
}): JSX.Element {
  const t = useTranslations('admin.organizations.hero');

  const total = organizations.length;
  const activeCount = organizations.filter((o) => o.status === 'active').length;
  const suspendedCount = organizations.filter((o) => o.status === 'suspended').length;
  const totalSeats = organizations.reduce((sum, o) => sum + o.seat_count_used, 0);

  return (
    <HeroShell
      image={
        <div className="flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-primary-foreground shadow-md">
          <Building2 className="h-9 w-9" />
        </div>
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
          label: t('suspendedLabel'),
          value: String(suspendedCount),
          color: suspendedCount > 0 ? 'var(--warning)' : undefined,
          sub: t('suspendedSub'),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function OrgsToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onCreate,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  onCreate: () => void;
}): JSX.Element {
  const t = useTranslations('admin.organizations');

  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      <div className="relative min-w-[260px]">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
        <Input
          inputSize="sm"
          className="pl-9"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => { onSearchChange(e.target.value); }}
          aria-label={t('searchAria')}
        />
      </div>
      <Select
        selectSize="sm"
        value={statusFilter}
        onChange={(e) => { onStatusFilterChange(e.target.value); }}
        aria-label={t('statusFilterAria')}
      >
        <option value="all">{t('statusFilters.all')}</option>
        <option value="active">{t('statusFilters.active')}</option>
        <option value="suspended">{t('statusFilters.suspended')}</option>
        <option value="provisioning">{t('statusFilters.provisioning')}</option>
      </Select>
      <div className="flex-1" />
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('createButton')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewPane({
  organizations,
}: {
  organizations: OrganizationRead[];
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

  const recentOrgs = [...organizations]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {/* Tenants by status */}
      <div className="rounded-xl border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('byStatusTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
              <span className="h-2.5 w-2.5 rounded-sm bg-success" />
              {t('statusActive')}
            </div>
            <span className="font-mono text-body3 text-foreground-tertiary">{byStatus.active.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
              {t('statusSuspended')}
            </div>
            <span className="font-mono text-body3 text-foreground-tertiary">{byStatus.suspended.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-body3 font-medium text-foreground-secondary">
              <span className="h-2.5 w-2.5 rounded-sm bg-foreground-tertiary" />
              {t('statusProvisioning')}
            </div>
            <span className="font-mono text-body3 text-foreground-tertiary">{byStatus.provisioning.length}</span>
          </div>
        </div>
      </div>

      {/* Seat allocation */}
      <div className="rounded-xl border border-border bg-surface-low p-5">
        <h3 className="mb-4 text-body2 font-bold">{t('seatAllocationTitle')}</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('seatsInUse')}</span>
            <span className="font-mono text-body3 font-semibold">{totalSeats}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body3 text-foreground-secondary">{t('totalCapacity')}</span>
            <span className="font-mono text-body3 text-foreground-tertiary">
              {totalCapacity}{unlimitedCount > 0 ? ` + ${unlimitedCount} ∞` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Recently created */}
      <div className="rounded-xl border border-border bg-surface-low p-5 xl:col-span-2">
        <h3 className="mb-4 text-body2 font-bold">{t('recentTitle')}</h3>
        {recentOrgs.length === 0 ? (
          <p className="text-body3 text-foreground-tertiary">{t('noTenants')}</p>
        ) : (
          <div className="divide-y divide-border">
            {recentOrgs.map((org) => (
              <div key={org.id} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-body3 font-medium">{org.name}</span>
                  <span className="ml-2 font-mono text-caption text-foreground-tertiary">{org.schema_name}</span>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminOrganizationsPage(): JSX.Element {
  const t = useTranslations('admin.organizations');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState('overview');

  const params = {
    q: search === '' ? undefined : search,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };
  const query = useAdminOrganizations(params);
  const allOrgs = query.data ?? [];

  const crumbs = useMemo(
    () => [
      { label: t('pageTitle'), href: undefined },
    ],
    [t],
  );
  useHeaderCrumbsOverride(crumbs);

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
  }[tab] ?? { eyebrow: '', title: '', sub: '' };

  return (
    <PageShell
      hero={
        <AdminOrgsHero organizations={allOrgs} />
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Underline tabs */}
        <TabsList className="shrink-0 gap-1 rounded-none border-b border-border bg-surface-main p-0 px-5">
          <TabsTrigger value="overview" className={TAB_CLASS}>
            <LayoutGrid className="h-3.5 w-3.5" />
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="organizations" className={TAB_CLASS}>
            <Table2 className="h-3.5 w-3.5" />
            {t('tabs.organizations')}
            <span className="rounded-full bg-primary-lighter px-1.5 py-px text-caption font-bold text-primary">
              {allOrgs.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Panel header */}
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3">
            <div className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary after:ml-2 after:opacity-50 after:content-['·']">
              {panelHeading.eyebrow}
            </div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-body2 font-bold">{panelHeading.title}</h2>
              {panelHeading.sub !== '' && (
                <span className="text-body3 text-foreground-tertiary before:mr-1.5 before:opacity-60 before:content-['·']">
                  {panelHeading.sub}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar for organizations tab */}
        {tab === 'organizations' && (
          <OrgsToolbar
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onCreate={() => { setCreateOpen(true); }}
          />
        )}

        {/* Scrollable tab content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <TabsContent value="organizations" className="mt-0">
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
                <OrgTable organizations={allOrgs} />
                <div className="mt-3 flex items-center justify-between text-body3 text-foreground-tertiary">
                  <span>{t('showing', { count: allOrgs.length })}</span>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="overview" className="mt-0">
            {query.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <OverviewPane organizations={allOrgs} />
            )}
          </TabsContent>
        </div>
      </Tabs>

      <OrgCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageShell>
  );
}
