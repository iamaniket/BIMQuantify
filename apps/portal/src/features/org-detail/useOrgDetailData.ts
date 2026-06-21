'use client';

import { useCallback, useMemo, useState } from 'react';

import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { useClientPagination } from '@/lib/query/useTableQuery';

import {
  AUDIT_FETCH_LIMIT,
  AUDIT_PAGE_SIZE,
  computeSince,
  exportAuditCsv,
  matchesActionFilter,
} from './orgDetailHelpers';
import type { OrgDetailViewProps } from './types';

export function useOrgDetailData({
  org,
  members,
  membersLoading,
  membersError,
}: Pick<OrgDetailViewProps, 'org' | 'members' | 'membersLoading' | 'membersError'>) {
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Audit filters. The date filter drives the server fetch (`since`); the action
  // filter is applied client-side; both feed the client-paginated footer below.
  const [dateFilter, setDateFilter] = useState('7');
  const [actionFilter, setActionFilter] = useState('all');

  const auditSince = useMemo(() => computeSince(dateFilter), [dateFilter]);

  const internalAuditQuery = useOrgAuditLog(org.id, {
    since: auditSince,
    limit: AUDIT_FETCH_LIMIT,
  });

  const internalAuditEntries = internalAuditQuery.data ?? [];

  const filteredAuditEntries = useMemo(
    () => internalAuditEntries.filter((e) => matchesActionFilter(e.action, actionFilter)),
    [internalAuditEntries, actionFilter],
  );

  const handleDateFilterChange = useCallback((v: string) => {
    setDateFilter(v);
  }, []);

  const handleExportCsv = useCallback(() => {
    exportAuditCsv(filteredAuditEntries);
  }, [filteredAuditEntries]);

  const filteredMembers = useMemo(() => members.filter((m) => {
    if (roleFilter === 'admin' && !m.is_org_admin) return false;
    if (roleFilter === 'member' && m.is_org_admin) return false;
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const nameMatch = m.full_name !== null && m.full_name.toLowerCase().includes(q);
      const emailMatch = m.email.toLowerCase().includes(q);
      if (!nameMatch && !emailMatch) return false;
    }
    return true;
  }), [members, roleFilter, statusFilter, query]);

  const membersTable = useClientPagination(filteredMembers, {
    sortAccessors: {
      name: (m) => m.full_name ?? m.email,
      status: (m) => m.status,
      invited: (m) => m.invited_at,
    },
    initialSort: { key: 'name', dir: 'asc' },
    isLoading: membersLoading,
    isError: membersError,
  });

  const auditTable = useClientPagination(filteredAuditEntries, {
    sortAccessors: {
      created_at: (e) => e.created_at,
      action: (e) => e.action,
      resource_type: (e) => e.resource_type,
    },
    initialPageSize: AUDIT_PAGE_SIZE,
    initialSort: { key: 'created_at', dir: 'desc' },
    isLoading: internalAuditQuery.isLoading,
    isError: internalAuditQuery.isError,
  });

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  return {
    tab,
    setTab,
    query,
    setQuery,
    roleFilter,
    setRoleFilter,
    statusFilter,
    setStatusFilter,
    dateFilter,
    setDateFilter,
    actionFilter,
    setActionFilter,
    filteredAuditEntries,
    handleDateFilterChange,
    handleExportCsv,
    membersTable,
    auditTable,
    activeCount,
    pendingCount,
  };
}
