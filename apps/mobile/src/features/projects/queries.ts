import { listModelsWithVersions } from '@/lib/api/models';
import { listProjects } from '@/lib/api/projects';
import { useAuthQuery } from '@/lib/query/useAuthQuery';
import type { ProjectFile } from '@/lib/api/schemas/files';
import type { ModelWithVersions } from '@/lib/api/schemas/models';
import type { ProjectList } from '@/lib/api/schemas/projects';

export function useProjects() {
  return useAuthQuery<ProjectList>(['projects'], (token) => listProjects(token));
}

export function useProjectModels(projectId: string) {
  return useAuthQuery<ModelWithVersions[]>(
    ['projects', projectId, 'models'],
    (token) => listModelsWithVersions(token, projectId),
    { enabled: projectId.length > 0 },
  );
}

/** Latest ready file for a model (highest version_number with status 'ready'),
 * or null if none is viewable yet. */
export function latestReadyFile(model: ModelWithVersions): ProjectFile | null {
  return (
    model.versions
      .filter((v) => v.status === 'ready')
      .sort((a, b) => b.version_number - a.version_number)[0] ?? null
  );
}
