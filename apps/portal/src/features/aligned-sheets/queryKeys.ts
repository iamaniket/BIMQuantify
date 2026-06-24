export const alignedSheetsKey = (
  projectId: string,
): readonly ['projects', string, 'aligned-sheets'] => [
  'projects',
  projectId,
  'aligned-sheets',
] as const;

export const alignedSheetDetailKey = (
  projectId: string,
  sheetId: string,
): readonly ['projects', string, 'aligned-sheets', string] => [
  'projects',
  projectId,
  'aligned-sheets',
  sheetId,
] as const;
