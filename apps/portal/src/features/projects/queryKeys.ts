export const projectsKey = ['projects'] as const;

export const projectKey = (id: string): readonly ['projects', string] => ['projects', id] as const;

export const projectMembersKey = (projectId: string): readonly ['projects', string, 'members'] => ['projects', projectId, 'members'] as const;

export const projectDeadlinesKey = (projectId: string): readonly ['projects', string, 'deadlines'] => ['projects', projectId, 'deadlines'] as const;

/** Activity feed page key. `params` (filters + pagination + sort) is matched
 * structurally by React Query, so the panel's `useTableQuery` and the card's
 * hover-prefetch share a cache entry when they build identical params. */
export const projectActivityKey = <P>(
  projectId: string,
  params: P,
): readonly ['projects', string, 'activity', P] =>
  ['projects', projectId, 'activity', params] as const;

/** True for any project-activity feed query key, regardless of project/params.
 * Used by the global mutation + WebSocket hooks that don't know the active id. */
export const isProjectActivityQueryKey = (key: readonly unknown[]): boolean =>
  key[0] === 'projects' && key[2] === 'activity';

export const projectDeadlineSettingsKey = (projectId: string): readonly ['projects', string, 'deadline-settings'] => ['projects', projectId, 'deadline-settings'] as const;

export const orgDeadlineSettingsKey = ['org-deadline-settings'] as const;
