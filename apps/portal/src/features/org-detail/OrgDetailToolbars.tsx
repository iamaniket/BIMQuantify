'use client';

import { Download, Plus, Search } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Button,
  Input,
  Select,
} from '@bimdossier/ui';

// ---------------------------------------------------------------------------
// Toolbars
// ---------------------------------------------------------------------------

export function MembersToolbar({
  query,
  onQueryChange,
  roleFilter,
  onRoleFilterChange,
  statusFilter,
  onStatusFilterChange,
  onInvite,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  roleFilter: string;
  onRoleFilterChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  onInvite: () => void;
}): JSX.Element {
  const t = useTranslations('orgDetail.toolbar');
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      <div className="relative min-w-[260px]">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
        <Input
          inputSize="md"
          className="pl-9"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); }}
        />
      </div>
      <Select selectSize="md" value={roleFilter} onChange={(e) => { onRoleFilterChange(e.target.value); }}>
        <option value="all">{t('roleAll')}</option>
        <option value="admin">{t('roleAdmin')}</option>
        <option value="member">{t('roleMember')}</option>
      </Select>
      <Select selectSize="md" value={statusFilter} onChange={(e) => { onStatusFilterChange(e.target.value); }}>
        <option value="all">{t('statusAll')}</option>
        <option value="active">{t('statusActive')}</option>
        <option value="pending">{t('statusPending')}</option>
        <option value="suspended">{t('statusSuspended')}</option>
      </Select>
      <div className="flex-1" />
      <Button size="md" className="whitespace-nowrap" onClick={onInvite}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('inviteButton')}
      </Button>
    </div>
  );
}

export function AuditToolbar({
  dateFilter,
  onDateFilterChange,
  actionFilter,
  onActionFilterChange,
  onExportCsv,
}: {
  dateFilter: string;
  onDateFilterChange: (v: string) => void;
  actionFilter: string;
  onActionFilterChange: (v: string) => void;
  onExportCsv: () => void;
}): JSX.Element {
  const t = useTranslations('orgDetail.toolbar');
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      <Select selectSize="md" value={dateFilter} onChange={(e) => { onDateFilterChange(e.target.value); }}>
        <option value="today">{t('dateToday')}</option>
        <option value="7">{t('date7')}</option>
        <option value="30">{t('date30')}</option>
        <option value="all">{t('dateAll')}</option>
      </Select>
      <Select selectSize="md" value={actionFilter} onChange={(e) => { onActionFilterChange(e.target.value); }}>
        <option value="all">{t('actionAll')}</option>
        <option value="auth">auth.*</option>
        <option value="member">member.*</option>
        <option value="settings">settings.*</option>
      </Select>
      <div className="flex-1" />
      <Button variant="primary" size="md" className="whitespace-nowrap" onClick={onExportCsv}>
        <Download className="mr-1 h-3.5 w-3.5" />
        {t('exportCsv')}
      </Button>
    </div>
  );
}
