export const reportsListKey = (projectId: string, reportType?: string) =>
  ['projects', projectId, 'reports', reportType ?? 'all'] as const;

export const reportKey = (projectId: string, reportId: string) =>
  ['projects', projectId, 'report', reportId] as const;
