import type { ReactNode } from 'react';

import type { AuditEntry, MemberRead } from '@/lib/api/schemas';

export type OrgDetailData = {
  id: string;
  name: string;
  status: string;
  seatLimit: number | null;
  seatCountUsed: number;
  imageUrl: string | null;
  schemaName: string | null;
  createdAt: string | null;
  provisionedAt: string | null;
};

export type OrgDetailViewProps = {
  org: OrgDetailData;
  members: MemberRead[];
  membersLoading: boolean;
  membersError: boolean;
  auditEntries: AuditEntry[];
  auditLoading: boolean;
  auditError: boolean;
  onInvite: () => void;
  heroActions?: ReactNode;
  tabBarActions?: ReactNode;
  overviewQuickActions?: ReactNode;
  onDelete?: () => void;
  onImageUpload?: (file: File) => void;
  onImageRemove?: () => void;
};
