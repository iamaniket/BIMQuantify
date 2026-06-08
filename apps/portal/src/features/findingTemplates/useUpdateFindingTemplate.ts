'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateFindingTemplate } from '@/lib/api/findingTemplates';
import type { FindingTemplate, FindingTemplateUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingTemplatesKey } from './queryKeys';

type UpdateVars = { id: string; input: FindingTemplateUpdateInput };

export function useUpdateFindingTemplate(): UseMutationResult<FindingTemplate, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { id, input }) => updateFindingTemplate(accessToken, id, input),
    invalidateKeys: [findingTemplatesKey()],
  });
}
