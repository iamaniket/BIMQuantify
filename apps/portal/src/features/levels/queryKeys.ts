export const levelsKey = (
  projectId: string,
): readonly ['projects', string, 'levels'] => ['projects', projectId, 'levels'] as const;
