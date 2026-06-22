'use client';

import { create } from 'zustand';

import type { FindingStatusValue } from '@/lib/api/schemas';

/**
 * The staged-but-unsaved anchor for the finding being edited. `null` = the user
 * staged a removal; an object = a re-picked position. `kind` discriminates the
 * 3D (ifc) world point from the 2D (pdf) normalized page point.
 */
export type FindingPinPreviewAnchor =
  | { kind: 'ifc'; x: number; y: number; z: number }
  | { kind: 'pdf'; x: number; y: number; page: number }
  | null;

export interface FindingPinPreview {
  findingId: string;
  anchor: FindingPinPreviewAnchor;
  label: string;
  status: FindingStatusValue;
}

interface FindingPinPreviewState {
  /** Single slot — only one finding detail form is expanded at a time. */
  preview: FindingPinPreview | null;
  setPreview: (preview: FindingPinPreview) => void;
  /**
   * Clear the preview. When `findingId` is given, only clears if it matches the
   * current preview — so a fast switch to another finding (the new form mounts
   * before the old one's cleanup runs) can't wipe the new preview.
   */
  clear: (findingId?: string) => void;
}

/**
 * Bridges the finding detail form's staged anchor to the viewer marker hooks so
 * a re-picked pin shows as a distinct "draft" marker immediately, before Save.
 * Written by `useFindingDetailForm`; read/merged by `useModelFindingMarkers` and
 * `usePageFindingMarkers`. Cleared on save success / cancel / collapse so the
 * marker reverts to (or is replaced by) the persisted server position.
 */
export const useFindingPinPreviewStore = create<FindingPinPreviewState>()((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
  clear: (findingId) =>
    set((s) => {
      if (
        findingId !== undefined &&
        s.preview !== null &&
        s.preview.findingId !== findingId
      ) {
        return s; // a different finding owns the preview now — leave it.
      }
      return s.preview === null ? s : { preview: null };
    }),
}));
