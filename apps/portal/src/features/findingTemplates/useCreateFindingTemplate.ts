'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createFindingTemplate } from '@/lib/api/findingTemplates';
import type { FindingTemplate, FindingTemplateCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingTemplatesKey } from './queryKeys';

export function useCreateFindingTemplate(): UseMutationResult<
  FindingTemplate,
  Error,
  FindingTemplateCreateInput
> {
  return useAuthMutation({
    mutationFn: (accessToken, input) => createFindingTemplate(accessToken, input),
    invalidateKeys: [findingTemplatesKey()],
  });
}
