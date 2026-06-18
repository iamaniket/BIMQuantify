import { getFinding, listFindings, createFinding } from '@/lib/api/findings';
import type { Finding, FindingCreateInput, FindingList } from '@/lib/api/schemas/findings';
import { useAuthQuery } from '@/lib/query/useAuthQuery';
import { useAuthMutation } from '@/lib/query/useAuthMutation';

export function useProjectFindings(projectId: string) {
  return useAuthQuery<FindingList>(
    ['projects', projectId, 'findings'],
    (token) => listFindings(token, projectId),
    { enabled: projectId.length > 0 },
  );
}

export function useFinding(projectId: string, findingId: string) {
  return useAuthQuery<Finding>(
    ['projects', projectId, 'findings', findingId],
    (token) => getFinding(token, projectId, findingId),
    { enabled: projectId.length > 0 && findingId.length > 0 },
  );
}

export function useCreateFindingMutation(projectId: string) {
  return useAuthMutation<Finding, FindingCreateInput>(
    (token, input) => createFinding(token, projectId, input),
    { invalidateKeys: [['projects', projectId, 'findings']] },
  );
}
