'use client';

import { useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { deleteProject } from '@/lib/api/projects';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

export type DeleteProjectArgs = {
  id: string;
};

export function useDeleteProject(): UseMutationResult<void, Error, DeleteProjectArgs> {
  const queryClient = useQueryClient();
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { id }) =>
      deleteProject(accessToken, id, isPooled),
    // Invalidate ONLY the projects list, exactly. A fuzzy invalidate of
    // ['projects'] would also refetch the active ['projects', id] detail query
    // on the still-mounted detail page, which 404s and flashes "not found"
    // before navigation completes. The list refetches when we navigate to it.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKey, exact: true });
    },
  });
}
