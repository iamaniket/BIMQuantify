'use client';

import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';
import type { JurisdictionBorgingsmomentTemplate } from '@/lib/api/jurisdictions';

export type PhaseLabel = { code: string; label: string };

export type BorgingsplanCatalog = {
  phases: PhaseLabel[];
  templates: JurisdictionBorgingsmomentTemplate[];
};

export function useBorgingsplanCatalog(
  country: string | null | undefined,
): BorgingsplanCatalog | null {
  const jurisdiction = useJurisdiction(country);
  if (jurisdiction === null) return null;
  const phases = Object.entries(jurisdiction.borgingsmoment_phase_labels).map(
    ([code, label]) => ({ code, label }),
  );
  return {
    phases,
    templates: jurisdiction.borgingsmoment_templates,
  };
}
