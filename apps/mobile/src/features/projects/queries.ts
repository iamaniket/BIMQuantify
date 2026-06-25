import { listDocumentsWithVersions } from '@/lib/api/documents';
import { getProject, listProjects } from '@/lib/api/projects';
import { useOfflineItemQuery, useOfflineListQuery } from '@/lib/query/useOfflineQuery';
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

/** Single project (for my_role — gates the inspector-only Verify action).
 * Cached offline under the 'project' entity keyed by id. */
export function useProject(projectId: string) {
  return useOfflineItemQuery<Project>(
    ['projects', projectId, 'detail'],
    'project',
    'all',
    projectId,
    (token) => getProject(token, projectId),
    { enabled: projectId.length > 0 },
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
