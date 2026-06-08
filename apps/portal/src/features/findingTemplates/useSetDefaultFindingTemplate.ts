'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { setDefaultFindingTemplate } from '@/lib/api/findingTemplates';
import type { FindingTemplate } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { findingTemplatesKey } from './queryKeys';

export function useSetDefaultFindingTemplate(): UseMutationResult<FindingTemplate, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, templateId) => setDefaultFindingTemplate(accessToken, templateId),
    invalidateKeys: [findingTemplatesKey()],
  });
}
