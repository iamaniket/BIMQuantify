export const complianceDataKey = (
  projectId: string,
  fileId?: string,
  modelId?: string,
) => ['projects', projectId, 'compliance', 'data', fileId ?? '', modelId ?? ''] as const;

export const complianceSummaryKey = (
  projectId: string,
) => ['projects', projectId, 'compliance', 'summary'] as const;

export const complianceDomainsKey = (
  projectId: string,
) => ['projects', projectId, 'compliance', 'domains'] as const;

export const complianceArticlesKey = (
  projectId: string,
) => ['projects', projectId, 'compliance', 'articles'] as const;

export const issuesKey = (
  projectId: string,
) => ['projects', projectId, 'issues'] as const;

export const projectReportsKey = (
  projectId: string,
  framework?: string,
) => ['projects', projectId, 'compliance', 'reports', framework ?? 'all'] as const;
