export const projectsKey = ['projects'] as const;

export const projectKey = (id: string): readonly ['projects', string] => ['projects', id] as const;

export const projectMembersKey = (projectId: string): readonly ['projects', string, 'members'] => ['projects', projectId, 'members'] as const;
