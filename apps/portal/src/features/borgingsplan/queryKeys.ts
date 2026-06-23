export const borgingsplanKey = (projectId: string): readonly [string, string, string] =>
  ['projects', projectId, 'borgingsplan'] as const;
