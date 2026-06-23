export const certificatesKey = (projectId: string) =>
  ['projects', projectId, 'certificates'] as const;

export const certificateViewUrlKey = (
  projectId: string,
  certificateId: string,
) => ['projects', projectId, 'certificates', certificateId, 'view-url'] as const;
