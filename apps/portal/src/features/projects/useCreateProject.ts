'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  createProject, createProjectWithThumbnail, updateProject,
} from '@/lib/api/projects';
import type {
  Project, ProjectCreateInput, ProjectUpdateInput,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

export type ProjectCreatePayload = ProjectCreateInput & {
  thumbnailFile: File | undefined;
};

export function useCreateProject(): UseMutationResult<Project, Error, ProjectCreatePayload> {
  return useAuthMutation({
    mutationFn: async (accessToken, { thumbnailFile, ...input }) => {
      if (thumbnailFile === undefined) {
        return createProject(accessToken, input);
      }
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
    invalidateKeys: [projectsKey],
  });
}
