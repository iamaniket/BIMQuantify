'use client';

import type { FindingTemplate } from '@/lib/api/schemas';

import { useFindingTemplates } from './useFindingTemplates';

/**
 * The org's default finding template, or null when none is marked (in which
 * case the Log-finding button opens the built-in "standard form").
 */
export function useDefaultFindingTemplate(): FindingTemplate | null {
  const { data } = useFindingTemplates();
  if (data === undefined) return null;
  return data.find((t) => t.is_default) ?? null;
}
