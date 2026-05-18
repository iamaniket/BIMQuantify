import type { WizardStep } from '@bimstitch/ui';

import type {
  BuildingTypeValue,
  ConsequenceClassValue,
  ProjectPhaseValue,
  ProjectStatusValue,
} from '@/lib/api/schemas';

import type { ProjectFormValues } from '../projectFormSchema';

// Neutral English fallback labels. The wizard overlays jurisdiction
// labels via `useWizardOptions.ts` once `GET /jurisdictions?locale=` has
// returned — so an NL project displayed in `/nl/...` ends up reading
// "Ontwerp" / "Ruwbouw" / etc. instead of these defaults.
export const STATUS_OPTIONS: readonly { value: ProjectStatusValue; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'design', label: 'Design' },
  { value: 'permit_review', label: 'Permit review' },
  { value: 'construction', label: 'Construction' },
  { value: 'handover', label: 'Handover' },
  { value: 'complete', label: 'Completed' },
  { value: 'on_hold', label: 'On hold' },
];

export const PHASE_OPTIONS: readonly { value: ProjectPhaseValue; label: string }[] = [
  { value: 'design', label: 'Design' },
  { value: 'tender', label: 'Tender' },
  { value: 'work_prep', label: 'Work preparation' },
  { value: 'shell', label: 'Shell' },
  { value: 'finishing', label: 'Finishing' },
  { value: 'handover', label: 'Handover' },
];

// Neutral English fallback labels. Overlaid by `useWizardOptions.ts`
// with the country/locale-specific labels from GET /jurisdictions.
export const BUILDING_TYPE_OPTIONS: readonly {
  value: BuildingTypeValue;
  label: string;
}[] = [
  { value: 'dwelling', label: 'Dwelling' },
  { value: 'commercial', label: 'Commercial building' },
  { value: 'other', label: 'Other' },
];

// Eurocode CC1/CC2/CC3 = NL GK1/GK2/GK3. The `disabled` flag mirrors the
// API's allowed_consequence_classes for the NL jurisdiction (today: CC1
// only — CC2/CC3 are roadmap and the server would reject them).
export const CONSEQUENCE_CLASS_OPTIONS: readonly {
  value: ConsequenceClassValue;
  label: string;
  disabled: boolean;
}[] = [
  { value: 'cc1', label: 'Consequence class 1 (CC1)', disabled: false },
  { value: 'cc2', label: 'Consequence class 2 (CC2) — out of scope', disabled: true },
  { value: 'cc3', label: 'Consequence class 3 (CC3) — out of scope', disabled: true },
];

// Toegelaten instrumenten mirror of the API's NL_INSTRUMENTS list
// (apps/api/src/bimstitch_api/jurisdictions/nl.py). To update: edit both
// sides in lockstep — server validates the id against its own copy, so a
// portal-only entry would 422 on submit. See README ("Updating toegelaten
// instrumenten") for the cadence.
export const INSTRUMENT_OPTIONS: readonly {
  value: string;
  label: string;
  provider: string;
  methodology_url: string;
}[] = [
  {
    value: 'kik',
    label: 'KiK',
    provider: 'Stichting Kwaliteitsborging in de Bouw',
    methodology_url: 'https://www.tlokb.nl/register',
  },
  {
    value: 'tis-kwaliteitsborger-wkb',
    label: 'TIS Kwaliteitsborger Wkb',
    provider: 'SWK',
    methodology_url: 'https://www.tlokb.nl/register',
  },
  {
    value: 'wki-gk1',
    label: 'WKI-GK1',
    provider: 'Stichting Wkb-instrumenten',
    methodology_url: 'https://www.tlokb.nl/register',
  },
  {
    value: 'adp-bouwkwaliteit',
    label: 'ADP-Bouwkwaliteit',
    provider: 'ADP Bouwkwaliteit',
    methodology_url: 'https://www.tlokb.nl/register',
  },
];

/** Stable step identifiers — used for React keys and step lookup. */
export type ProjectWizardStepId = 'basics' | 'details' | 'address' | 'contractor';

/** Field names per step, used to scope `form.trigger([...])` validation. */
export const PROJECT_WIZARD_STEP_FIELDS: Record<
  ProjectWizardStepId,
  readonly (keyof ProjectFormValues)[]
> = {
  basics: ['name', 'description'],
  details: [
    'reference_code',
    'status',
    'phase',
    'building_type',
    'consequence_class',
    'instrument_id',
    'planned_start_date',
    'delivery_date',
    'permit_number',
  ],
  address: [
    'street',
    'house_number',
    'postal_code',
    'city',
    'municipality',
    'bag_id',
    'latitude',
    'longitude',
  ],
  contractor: ['contractor_id'],
} as const;

/** Ordered step list rendered in the wizard stepper. */
export const PROJECT_WIZARD_STEPS: readonly (WizardStep & { id: ProjectWizardStepId })[] = [
  {
    id: 'basics',
    title: 'Basics',
    description: 'Name and description',
  },
  {
    id: 'details',
    title: 'Details',
    description: 'Status, phase, dates',
    optional: true,
  },
  {
    id: 'address',
    title: 'Address',
    description: 'Site location',
    optional: true,
  },
  {
    id: 'contractor',
    title: 'Contractor',
    description: 'Assign a company',
    optional: true,
  },
] as const;

export const PROJECT_WIZARD_STEP_IDS: readonly ProjectWizardStepId[] = (
  PROJECT_WIZARD_STEPS.map((s) => s.id)
);
