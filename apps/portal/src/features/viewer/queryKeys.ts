export const viewerKeys = {
  all: ['viewer'] as const,
  bundle: (
    projectId: string,
    modelId: string,
    fileId: string,
  ): readonly ['viewer', 'bundle', string, string, string] =>
    ['viewer', 'bundle', projectId, modelId, fileId] as const,
};
