export const projectsKey = ['projects'] as const;

export const projectKey = (id: string): readonly ['projects', string] => ['projects', id] as const;

export const projectMembersKey = (projectId: string): readonly ['projects', string, 'members'] => ['projects', projectId, 'members'] as const;

export const projectDeadlinesKey = (projectId: string): readonly ['projects', string, 'deadlines'] => ['projects', projectId, 'deadlines'] as const;

export const projectDeadlineSettingsKey = (projectId: string): readonly ['projects', string, 'deadline-settings'] => ['projects', projectId, 'deadline-settings'] as const;

export const orgDeadlineSettingsKey = ['org-deadline-settings'] as const;
