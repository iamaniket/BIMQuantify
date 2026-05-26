export const documentsKey = (projectId: string) =>
  ['projects', projectId, 'documents'] as const;

export const captureLinksKey = (projectId: string) =>
  ['projects', projectId, 'capture-links'] as const;
