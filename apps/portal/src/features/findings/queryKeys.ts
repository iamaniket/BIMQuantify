export const findingsKey = (projectId: string): readonly [string, string, string] =>
  ['projects', projectId, 'findings'] as const;

// Element findings are keyed by (model, GlobalId) — version-independent — so a
// finding follows the element across re-uploaded file versions.
export const elementFindingsKey = (
  projectId: string,
  modelId: string,
  globalId: string,
): readonly [string, string, string, string, string, string] =>
  ['projects', projectId, 'findings', 'element', modelId, globalId] as const;

export const projectFindingsKey = (
  projectId: string,
): readonly [string, string, string, string] =>
  ['projects', projectId, 'findings', 'unlinked'] as const;

export const findingHistoryKey = (
  projectId: string,
  findingId: string,
): readonly [string, string, string, string, string] =>
  ['projects', projectId, 'findings', findingId, 'history'] as const;
