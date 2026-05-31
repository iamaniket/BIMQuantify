export const attachmentsKey = (projectId: string) =>
  ['projects', projectId, 'attachments'] as const;

// Keyed by (model, GlobalId) — version-independent — so an attachment follows
// the element across re-uploaded file versions.
export const elementAttachmentsKey = (projectId: string, modelId: string, globalId: string) =>
  ['projects', projectId, 'attachments', 'element', modelId, globalId] as const;

export const captureLinksKey = (projectId: string) =>
  ['projects', projectId, 'capture-links'] as const;
