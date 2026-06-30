/**
 * Free vs paid API-surface routing (mirrors the portal's `lib/api/scope.ts`).
 *
 * Free (org-less) and paid (org-scoped) endpoints return IDENTICAL schemas — the
 * backend emits the paid shape for free callers — so every mirrored fetcher takes
 * a single `free: boolean` (sourced from `useIsFree` / the cached `me`) and routes
 * through these helpers instead of duplicating a whole `freeX.ts` module. This is
 * the one place the `/free` prefix is written.
 */

/** Base path for a project's resources, e.g. `${projectScope(id, free)}/documents`. */
export const projectScope = (projectId: string, free: boolean): string =>
  `${free ? '/free/projects' : '/projects'}/${projectId}`;

/** Base path for the projects collection itself. */
export const projectsScope = (free: boolean): string => (free ? '/free/projects' : '/projects');
