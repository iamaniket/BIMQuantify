'use client';

import { useMemo } from 'react';

import { useDocumentsWithVersions } from '@/features/documents/useDocumentsWithVersions';
import { useProjectLevels } from '@/features/levels/hooks';
import type { DocumentWithVersions, Level } from '@/lib/api/schemas';

/** Bucket key for drawings not filed to any project Level. */
export const UNASSIGNED_LEVEL = '__unassigned__';

export type DrawingScope = {
  /** Project Levels, top→bottom (descending elevation), tie-broken by ordering/name. */
  levels: Level[];
  /** level_id (or `UNASSIGNED_LEVEL`) → its PDF drawing documents. */
  drawingsByLevel: Map<string, DocumentWithVersions[]>;
  /** Any PDF drawing exists at all (drives the empty state). */
  hasDrawings: boolean;
  isLoading: boolean;
};

/**
 * Persona-A scope: a project's PDF drawings organized by project Level, with no
 * 3D model. The Level is the spine (it exists for 2D-only projects too), so a
 * PDF-only project gets the same by-floor navigation as a modelled one.
 *
 * PDF-only this round — DXF/DWG drawings are a fast-follow (they also carry
 * `level_id`, so extending the filter is the only change needed).
 */
export function useDrawingScope(projectId: string): DrawingScope {
  const levelsQuery = useProjectLevels(projectId);
  const docsQuery = useDocumentsWithVersions(projectId);

  const drawings = useMemo(
    () => (docsQuery.data ?? []).filter((d) => d.primary_file_type === 'pdf'),
    [docsQuery.data],
  );

  const levels = useMemo(
    () =>
      [...(levelsQuery.data ?? [])].sort((a, b) => {
        const ea = a.elevation_m ?? Number.NEGATIVE_INFINITY;
        const eb = b.elevation_m ?? Number.NEGATIVE_INFINITY;
        if (ea !== eb) return eb - ea; // top → bottom
        if ((a.ordering ?? 0) !== (b.ordering ?? 0)) return (a.ordering ?? 0) - (b.ordering ?? 0);
        return a.name.localeCompare(b.name);
      }),
    [levelsQuery.data],
  );

  const drawingsByLevel = useMemo(() => {
    const m = new Map<string, DocumentWithVersions[]>();
    for (const d of drawings) {
      const key = d.level_id ?? UNASSIGNED_LEVEL;
      const arr = m.get(key);
      if (arr) arr.push(d);
      else m.set(key, [d]);
    }
    return m;
  }, [drawings]);

  return {
    levels,
    drawingsByLevel,
    hasDrawings: drawings.length > 0,
    isLoading: levelsQuery.isLoading || docsQuery.isLoading,
  };
}
