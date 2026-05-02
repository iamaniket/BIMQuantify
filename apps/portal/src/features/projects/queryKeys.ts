export const projectsKey = ['projects'] as const;

export const projectKey = (id: string): readonly ['projects', string] => ['projects', id] as const;

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

export const activityKey = (
  projectId: string,
) => ['projects', projectId, 'activity'] as const;

export const dossierKey = (
  projectId: string,
) => ['projects', projectId, 'dossier'] as const;

export const trendKey = (
  projectId: string,
) => ['projects', projectId, 'compliance', 'trend'] as const;

export const projectReportsKey = (
  projectId: string,
  framework?: string,
) => ['projects', projectId, 'compliance', 'reports', framework ?? 'all'] as const;

export const contractorsKey = ['contractors'] as const;
