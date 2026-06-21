'use client';

import { useMemo } from 'react';

import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';
import type {
  BuildingTypeValue,
  ProjectPhaseValue,
} from '@/lib/api/schemas';

import {
  BUILDING_TYPE_OPTIONS as FALLBACK_BUILDING_TYPE,
  PHASE_OPTIONS as FALLBACK_PHASE,
} from './projectWizardSteps';

export type WizardPhaseOption = { value: ProjectPhaseValue; label: string };
export type WizardBuildingTypeOption = { value: BuildingTypeValue; label: string };

export type WizardOptions = {
  phaseOptions: readonly WizardPhaseOption[];
  buildingTypeOptions: readonly WizardBuildingTypeOption[];
};

/**
 * Resolve wizard dropdown options for a project's country.
 *
 * Pulls localized labels from the jurisdictions registry (via `GET
 * /jurisdictions`) and overlays them on the neutral fallback constants
 * declared in `projectWizardSteps.ts`. While the jurisdictions query is
 * still loading or when the country has no registry entry, callers get the
 * fallback labels — so the wizard always has something to render.
 */
export function useWizardOptions(country: string | null | undefined): WizardOptions {
  const jurisdiction = useJurisdiction(country);

  return useMemo<WizardOptions>(() => {
    if (jurisdiction === null) {
      return {
        phaseOptions: FALLBACK_PHASE,
        buildingTypeOptions: FALLBACK_BUILDING_TYPE,
      };
    }

    return {
      phaseOptions: FALLBACK_PHASE.map((opt) => ({
        value: opt.value,
        label: jurisdiction.phase_labels[opt.value] ?? opt.label,
      })),
      buildingTypeOptions: FALLBACK_BUILDING_TYPE.map((opt) => ({
        value: opt.value,
        label: jurisdiction.building_type_labels[opt.value] ?? opt.label,
      })),
    };
  }, [jurisdiction]);
}
