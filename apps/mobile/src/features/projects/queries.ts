import { listDocumentsWithVersions } from '@/lib/api/documents';
import { listProjects } from '@/lib/api/projects';
import { useOfflineListQuery } from '@/lib/query/useOfflineQuery';
import type { DocumentWithVersions } from '@/lib/api/schemas/documents';
import type { ProjectFile } from '@/lib/api/schemas/files';
import type { Project } from '@/lib/api/schemas/projects';

export function useProjects() {
  return useOfflineListQuery<Project>(
    ['projects'],
    'project',
    'all',
    (token) => listProjects(token),
  );
}

export function useProjectDocuments(projectId: string) {
  return useOfflineListQuery<DocumentWithVersions>(
    ['projects', projectId, 'documents'],
    'document',
    projectId,
    (token) => listDocumentsWithVersions(token, projectId),
    { enabled: projectId.length > 0 },
  );
}

/** Latest ready file for a document (highest version_number with status 'ready'),
 * or null if none is viewable yet. */
export function latestReadyFile(document: DocumentWithVersions): ProjectFile | null {
  return (
    document.versions
      .filter((v) => v.status === 'ready')
      .sort((a, b) => b.version_number - a.version_number)[0] ?? null
  );
}
