export const attachmentsKey = (projectId: string) =>
  ['projects', projectId, 'attachments'] as const;

export const captureLinksKey = (projectId: string) =>
  ['projects', projectId, 'capture-links'] as const;
