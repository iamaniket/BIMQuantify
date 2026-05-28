export const attachmentsKey = (projectId: string) =>
  ['projects', projectId, 'attachments'] as const;

export const elementAttachmentsKey = (projectId: string, fileId: string, globalId: string) =>
  ['projects', projectId, 'attachments', 'element', fileId, globalId] as const;

export const captureLinksKey = (projectId: string) =>
  ['projects', projectId, 'capture-links'] as const;
