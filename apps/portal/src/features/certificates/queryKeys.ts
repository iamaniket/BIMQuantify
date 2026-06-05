export const certificatesKey = (projectId: string) =>
  ['projects', projectId, 'certificates'] as const;

// Keyed by (model, GlobalId) — version-independent — so a certificate follows
// the element across re-uploaded file versions.
export const elementCertificatesKey = (
  projectId: string,
  modelId: string,
  globalId: string,
) => ['projects', projectId, 'certificates', 'element', modelId, globalId] as const;

export const projectCertificatesKey = (
  projectId: string,
) => ['projects', projectId, 'certificates', 'unlinked'] as const;

export const certificateViewUrlKey = (
  projectId: string,
  certificateId: string,
) => ['projects', projectId, 'certificates', certificateId, 'view-url'] as const;

// Version history of one logical certificate (#35).
export const certificateVersionsKey = (
  projectId: string,
  certificateId: string,
) => ['projects', projectId, 'certificates', certificateId, 'versions'] as const;
