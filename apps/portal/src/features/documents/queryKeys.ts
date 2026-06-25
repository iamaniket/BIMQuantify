export const documentsKey = (
  projectId: string,
): readonly ['projects', string, 'documents'] => [
  'projects',
  projectId,
  'documents',
] as const;

export const documentsWithVersionsKey = (
  projectId: string,
): readonly ['projects', string, 'documents', 'with-versions'] => [
  'projects',
  projectId,
  'documents',
  'with-versions',
] as const;

export const documentKey = (
  projectId: string,
  documentId: string,
): readonly ['projects', string, 'documents', string] => [
  'projects',
  projectId,
  'documents',
  documentId,
] as const;

export const documentFilesKey = (
  projectId: string,
  documentId: string,
): readonly ['projects', string, 'documents', string, 'files'] => [
  'projects',
  projectId,
  'documents',
  documentId,
  'files',
] as const;
