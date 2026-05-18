export const risksKey = (projectId: string): readonly [string, string, string] =>
  ['projects', projectId, 'risks'] as const;
