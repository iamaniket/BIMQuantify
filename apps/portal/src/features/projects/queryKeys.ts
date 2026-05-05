export const projectsKey = ['projects'] as const;

export const projectKey = (id: string): readonly ['projects', string] => ['projects', id] as const;
