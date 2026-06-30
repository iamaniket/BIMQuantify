/**
 * Free vs paid API-surface routing (mirrors the portal's `lib/api/scope.ts`).
 *
 * Free (org-less) and paid (org-scoped) endpoints return IDENTICAL schemas — the
 * backend emits the paid shape for free callers — so every mirrored fetcher takes
 * a single `free: boolean` (sourced from `useIsPooledContext` / the cached `me`)
 * and routes through these helpers instead of duplicating a whole `freeX.ts`
 * module.
 *
 * The helpers are the single source of truth in `@bimdossier/contracts` (shared
 * char-for-char with apps/portal and pinned to the backend's `/pooled/*` route
 * aliases). Re-exported so existing `./scope` imports keep working.
 */
export { pooledPrefix, projectScope, projectsScope } from '@bimdossier/contracts';
