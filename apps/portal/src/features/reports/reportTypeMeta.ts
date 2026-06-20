import {
  ClipboardCheck, FolderOpen, PenLine, ShieldCheck,
} from '@bimstitch/ui/icons';
import type { AppIcon } from '@bimstitch/ui/icons';

import type { ReportStatus, ReportType } from '@/lib/api/schemas/reports';

/**
 * Shared report metadata for the Reports tab — the status→tone map, the
 * canonical type order, and the per-type icon + tile colors. Kept here so the
 * list card, the version timeline, and the preview drawer stay in sync.
 */

/** Badge tone per report status. */
export const STATUS_TONE: Record<
  ReportStatus,
  'default' | 'info' | 'warning' | 'success' | 'error'
> = {
  queued: 'info',
  running: 'warning',
  ready: 'success',
  failed: 'error',
};

/** Canonical order the four report types render in (also the generate order). */
export const REPORT_TYPE_ORDER: readonly ReportType[] = [
  'compliance_report',
  'assurance_plan',
  'completion_declaration',
  'dossier',
] as const;

type ReportTypeMeta = {
  icon: AppIcon;
  /** On-token tile colors for the card's media slot. */
  tileClass: string;
};

export const REPORT_TYPE_META: Record<ReportType, ReportTypeMeta> = {
  compliance_report: { icon: ShieldCheck, tileClass: 'bg-primary-light text-primary' },
  assurance_plan: { icon: ClipboardCheck, tileClass: 'bg-info-light text-info' },
  completion_declaration: { icon: PenLine, tileClass: 'bg-success-light text-success' },
  dossier: { icon: FolderOpen, tileClass: 'bg-warning-light text-warning' },
};
