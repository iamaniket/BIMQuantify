/**
 * Free vs paid API-surface routing.
 *
 * Free (org-less) and paid (org-scoped) endpoints return IDENTICAL schemas — the
 * backend emits the paid shape for free callers — so every mirrored fetcher takes
 * a single `free: boolean` (sourced from `useIsPooledContext`) and routes through
 * these helpers instead of duplicating a whole `freeX.ts` module. This is the one
 * place the `/free` prefix is written.
 */

/** Prefix for top-level mirrored collections, e.g. `${pooledPrefix(free)}/notifications`. */
export const pooledPrefix = (free: boolean): string => (free ? '/pooled' : '');

/** Base path for a project's resources, e.g. `${projectScope(id, free)}/levels`. */
export const projectScope = (projectId: string, free: boolean): string =>
  `${free ? '/pooled/projects' : '/projects'}/${projectId}`;

/** Base path for the projects collection itself. */
export const projectsScope = (free: boolean): string => (free ? '/pooled/projects' : '/projects');
