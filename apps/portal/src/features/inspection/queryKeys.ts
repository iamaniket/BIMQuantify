export const inspectionKeys = {
  results: (momentId: string) =>
    ['inspection', momentId, 'results'] as const,
  summary: (momentId: string) =>
    ['inspection', momentId, 'summary'] as const,
};
