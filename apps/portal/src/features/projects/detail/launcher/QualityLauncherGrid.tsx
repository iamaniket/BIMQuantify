'use client';

import type { JSX } from 'react';

import { AttachmentsLauncherCard } from './AttachmentsLauncherCard';
import { CertificatesLauncherCard } from './CertificatesLauncherCard';
import { FindingsLauncherCard } from './FindingsLauncherCard';
import { ReportsLauncherCard } from './ReportsLauncherCard';

/**
 * The "Quality & Documents" launcher grid on the project-detail page: one
 * enriched card per entity (Findings / Certificates / Attachments / Reports),
 * each previewing up to its 4 most recent items with in-place detail, a "View
 * all" link to its board, and a create action. The 2x2 grid fills the upper panel's
 * height (two equal `fr` rows) so the cards stretch into the available space
 * instead of leaving a dead gap above the lower panel; `min-h-[30rem]` keeps a
 * sensible floor on short viewports (enough for ~4 preview rows per card),
 * where the parent panel scrolls.
 */
export function QualityLauncherGrid({
  projectId,
  isFree = false,
}: {
  projectId: string;
  /** Free tier: certificates / attachments / reports are paid-only, so render
   * just the Findings launcher (full width). */
  isFree?: boolean;
}): JSX.Element {
  if (isFree) {
    return (
      <div className="grid h-full min-h-[30rem] grid-cols-1 gap-2">
        <FindingsLauncherCard projectId={projectId} />
      </div>
    );
  }
  return (
    <div className="grid h-full min-h-[30rem] grid-cols-2 grid-rows-2 gap-2">
      <FindingsLauncherCard projectId={projectId} />
      <CertificatesLauncherCard projectId={projectId} />
      <AttachmentsLauncherCard projectId={projectId} />
      <ReportsLauncherCard projectId={projectId} />
    </div>
  );
}
