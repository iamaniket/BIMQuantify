'use client';

import type { JurisdictionRiskTemplate } from '@/lib/api/jurisdictions';
import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';

export type BblRiskCatalog = {
  // Ordered list of categories the portal should render — preserves the
  // ordering coming from the registry rather than re-sorting client-side.
  categories: { code: string; label: string }[];
  templatesByCategory: Record<string, JurisdictionRiskTemplate[]>;
};

export function useBblRiskCatalog(country: string | null | undefined): BblRiskCatalog | null {
  const jurisdiction = useJurisdiction(country);
  if (jurisdiction === null) return null;

  const categories = Object.entries(jurisdiction.bbl_risk_category_labels).map(
    ([code, label]) => ({ code, label }),
  );
  return {
    categories,
    templatesByCategory: jurisdiction.risk_templates,
  };
}
