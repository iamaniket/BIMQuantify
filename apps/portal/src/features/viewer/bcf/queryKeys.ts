export const bcfKeys = {
  all: (projectId: string) => ['bcf', projectId] as const,
  list: (projectId: string) => ['bcf', projectId, 'list'] as const,
  detail: (projectId: string, topicId: string) =>
    ['bcf', projectId, 'detail', topicId] as const,
  markup2d: (projectId: string, fileId: string) =>
    ['bcf', projectId, 'markup-2d', fileId] as const,
};
