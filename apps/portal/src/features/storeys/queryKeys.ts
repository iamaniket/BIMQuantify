export const storeysKey = (
  projectId: string,
  modelId: string,
): readonly ['projects', string, 'models', string, 'storeys'] => [
  'projects',
  projectId,
  'models',
  modelId,
  'storeys',
] as const;
