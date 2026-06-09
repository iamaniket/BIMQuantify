export const bcfKeys = {
  all: (projectId: string) => ['bcf', projectId] as const,
  list: (projectId: string) => ['bcf', projectId, 'list'] as const,
  detail: (projectId: string, topicId: string) =>
    ['bcf', projectId, 'detail', topicId] as const,
};
