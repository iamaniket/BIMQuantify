'use client';

import {
  useMutation, useQueryClient, type UseMutationResult,
} from '@tanstack/react-query';

import {
  createProject, createProjectWithThumbnail, updateProject,
} from '@/lib/api/projects';
import type {
  Project, ProjectCreateInput, ProjectUpdateInput,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { projectsKey } from './queryKeys';

export type ProjectCreatePayload = ProjectCreateInput & {
  thumbnailFile: File | undefined;
};

export function useCreateProject(): UseMutationResult<Project, Error, ProjectCreatePayload> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;
  const queryClient = useQueryClient();

  return useMutation<Project, Error, ProjectCreatePayload>({
    mutationFn: async ({ thumbnailFile, ...input }) => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      if (thumbnailFile === undefined) {
        return createProject(accessToken, input);
      }
      // Two-step path: the thumbnail endpoint only accepts name + description,
      // so create with thumbnail first, then PATCH any remaining fields.
      const { name, description, ...rest } = input;
      const created = await createProjectWithThumbnail(
        accessToken,
        { name, description },
        thumbnailFile,
      );
      const extras: ProjectUpdateInput = rest;
      const hasExtras = Object.values(extras).some(
        (v) => v !== undefined && v !== '' && v !== null,
      );
      if (!hasExtras) return created;
      return updateProject(accessToken, created.id, extras);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectsKey });
    },
  });
}
