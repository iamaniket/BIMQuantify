'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { updateProject, uploadProjectThumbnail } from '@/lib/api/projects';
import type { Project, ProjectUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

export type UpdateProjectArgs = {
  id: string;
  input: ProjectUpdateInput;
  /** File = upload new thumbnail; null = remove existing; undefined = leave unchanged. */
  thumbnailFile?: File | null;
};

export function useUpdateProject(): UseMutationResult<Project, Error, UpdateProjectArgs> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthMutation({
    mutationFn: async (accessToken, { id, input, thumbnailFile }) => {
      // Free projects support a cover-image upload (File). Apply metadata first,
      // then the thumbnail so the returned project carries the presigned URL.
      if (isFreeUser) {
        const updated = await updateProject(accessToken, id, input, true);
        if (thumbnailFile instanceof File) {
          return uploadProjectThumbnail(accessToken, id, thumbnailFile, true);
        }
        return updated;
      }
      if (thumbnailFile instanceof File) {
        await uploadProjectThumbnail(accessToken, id, thumbnailFile);
      }
      const patchInput: ProjectUpdateInput = {
        ...input,
        ...(thumbnailFile === null ? { thumbnail_url: null } : {}),
      };
      return updateProject(accessToken, id, patchInput);
    },
    invalidateKeys: [projectsKey],
  });
}
