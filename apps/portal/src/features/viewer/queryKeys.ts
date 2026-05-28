export const viewerKeys = {
  all: ['viewer'] as const,
  bundle: (
    projectId: string,
    modelId: string,
    fileId: string,
  ): readonly ['viewer', 'bundle', string, string, string] =>
    ['viewer', 'bundle', projectId, modelId, fileId] as const,
  elementInspections: (
    projectId: string,
    fileId: string,
    globalId: string,
  ): readonly ['viewer', 'elementInspections', string, string, string] =>
    ['viewer', 'elementInspections', projectId, fileId, globalId] as const,
};
