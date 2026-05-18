export const borgingsplanKey = (projectId: string): readonly [string, string, string] =>
  ['projects', projectId, 'borgingsplan'] as const;

export const borgingsplanVersionsKey = (
  projectId: string,
): readonly [string, string, string, string] =>
  ['projects', projectId, 'borgingsplan', 'versions'] as const;
