'use client';

import { useMemo } from 'react';

import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';
import type {
  BuildingTypeValue,
  ConsequenceClassValue,
  ProjectPhaseValue,
  ProjectStatusValue,
} from '@/lib/api/schemas';

import {
  BUILDING_TYPE_OPTIONS as FALLBACK_BUILDING_TYPE,
  CONSEQUENCE_CLASS_OPTIONS as FALLBACK_CONSEQUENCE_CLASS,
  INSTRUMENT_OPTIONS as FALLBACK_INSTRUMENT,
  PHASE_OPTIONS as FALLBACK_PHASE,
  STATUS_OPTIONS as FALLBACK_STATUS,
} from './projectWizardSteps';

export type WizardStatusOption = { value: ProjectStatusValue; label: string };
export type WizardPhaseOption = { value: ProjectPhaseValue; label: string };
export type WizardBuildingTypeOption = { value: BuildingTypeValue; label: string };
export type WizardConsequenceClassOption = {
  value: ConsequenceClassValue;
  label: string;
  disabled: boolean;
};
export type WizardInstrumentOption = {
  value: string;
  label: string;
  provider: string;
  methodology_url: string;
};

export type WizardOptions = {
  statusOptions: readonly WizardStatusOption[];
  phaseOptions: readonly WizardPhaseOption[];
  buildingTypeOptions: readonly WizardBuildingTypeOption[];
  consequenceClassOptions: readonly WizardConsequenceClassOption[];
  instrumentOptions: readonly WizardInstrumentOption[];
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
        statusOptions: FALLBACK_STATUS,
        phaseOptions: FALLBACK_PHASE,
        buildingTypeOptions: FALLBACK_BUILDING_TYPE,
        consequenceClassOptions: FALLBACK_CONSEQUENCE_CLASS,
        instrumentOptions: FALLBACK_INSTRUMENT,
      };
    }

    const allowed = new Set(jurisdiction.allowed_consequence_classes);

    return {
      statusOptions: FALLBACK_STATUS.map((opt) => ({
        value: opt.value,
        label: jurisdiction.status_labels[opt.value] ?? opt.label,
      })),
      phaseOptions: FALLBACK_PHASE.map((opt) => ({
        value: opt.value,
        label: jurisdiction.phase_labels[opt.value] ?? opt.label,
      })),
      buildingTypeOptions: FALLBACK_BUILDING_TYPE.map((opt) => ({
        value: opt.value,
        label: jurisdiction.building_type_labels[opt.value] ?? opt.label,
      })),
      consequenceClassOptions: FALLBACK_CONSEQUENCE_CLASS.map((opt) => ({
        value: opt.value,
        label: jurisdiction.consequence_class_labels[opt.value] ?? opt.label,
        // Disabled if the registry says this code isn't allowed for the
        // country today, regardless of what the fallback said.
        disabled: !allowed.has(opt.value),
      })),
      instrumentOptions: jurisdiction.instruments.length > 0
        ? jurisdiction.instruments.map((inst) => ({
            value: inst.id,
            label: inst.name,
            provider: inst.provider,
            methodology_url: inst.methodology_url ?? '',
          }))
        : FALLBACK_INSTRUMENT,
    };
  }, [jurisdiction]);
}
