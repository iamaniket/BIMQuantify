import { useAuthMutation } from '@/lib/query/useAuthQuery';
import { updateOrganizationName } from '@/lib/api/organizations';

type Variables = { organizationId: string; name: string };

export function useUpdateOrgName() {
  return useAuthMutation<{ id: string; name: string }, Variables>({
    mutationFn: (accessToken, { organizationId, name }) =>
      updateOrganizationName(accessToken, organizationId, name),
  });
}
