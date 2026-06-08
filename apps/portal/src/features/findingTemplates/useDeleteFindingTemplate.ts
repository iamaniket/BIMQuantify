'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteFindingTemplate } from '@/lib/api/findingTemplates';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingTemplatesKey } from './queryKeys';

export function useDeleteFindingTemplate(): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, templateId) => deleteFindingTemplate(accessToken, templateId),
    invalidateKeys: [findingTemplatesKey()],
  });
}
