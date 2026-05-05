export const modelsKey = (
  projectId: string,
): readonly ['projects', string, 'models'] => [
  'projects',
  projectId,
  'models',
] as const;

export const modelKey = (
  projectId: string,
  modelId: string,
): readonly ['projects', string, 'models', string] => [
  'projects',
  projectId,
  'models',
  modelId,
] as const;

export const modelFilesKey = (
  projectId: string,
  modelId: string,
): readonly ['projects', string, 'models', string, 'files'] => [
  'projects',
  projectId,
  'models',
  modelId,
  'files',
] as const;
