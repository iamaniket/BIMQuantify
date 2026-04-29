'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import { createProject, createProjectWithThumbnail } from '@/lib/api/projects';
import type { Project, ProjectCreateInput } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

export type ProjectCreatePayload = ProjectCreateInput & { thumbnailFile?: File };

export function useCreateProject(): UseMutationResult<Project, Error, ProjectCreatePayload> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Project, Error, ProjectCreatePayload>({
    mutationFn: async ({ thumbnailFile, ...input }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      if (thumbnailFile !== undefined) {
        return createProjectWithThumbnail(accessToken, input, thumbnailFile);
      }
      return createProject(accessToken, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
