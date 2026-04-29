export const projectsKey = ['projects'] as const;

export const projectKey = (id: string): readonly ['projects', string] => ['projects', id] as const;

export const projectFilesKey = (id: string): readonly ['projects', string, 'files'] => [
  'projects',
  id,
  'files',
] as const;
