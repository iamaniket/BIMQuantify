export const findingsKey = (projectId: string): readonly [string, string, string] =>
  ['projects', projectId, 'findings'] as const;

export const elementFindingsKey = (
  projectId: string,
  fileId: string,
  globalId: string,
): readonly [string, string, string, string, string, string] =>
  ['projects', projectId, 'findings', 'element', fileId, globalId] as const;

export const projectFindingsKey = (
  projectId: string,
): readonly [string, string, string, string] =>
  ['projects', projectId, 'findings', 'unlinked'] as const;

export const findingHistoryKey = (
  projectId: string,
  findingId: string,
): readonly [string, string, string, string, string] =>
  ['projects', projectId, 'findings', findingId, 'history'] as const;
