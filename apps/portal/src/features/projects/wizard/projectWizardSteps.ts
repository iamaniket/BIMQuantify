import type { WizardStep } from '@/components/shared/wizard/Wizard';

import type {
  BuildingTypeValue,
  ProjectPhaseValue,
} from '@/lib/api/schemas';

import type { ProjectFormValues } from '../projectFormSchema';

// Neutral English fallback labels. The wizard overlays jurisdiction
// labels via `useWizardOptions.ts` once `GET /jurisdictions?locale=` has
// returned — so an NL project displayed in `/nl/...` ends up reading
// "Ontwerp" / "Ruwbouw" / etc. instead of these defaults.
export const PHASE_OPTIONS: readonly { value: ProjectPhaseValue; label: string }[] = [
  { value: 'design', label: 'Design' },
  { value: 'tender', label: 'Tender' },
  { value: 'work_prep', label: 'Work preparation' },
  { value: 'shell', label: 'Shell' },
  { value: 'finishing', label: 'Finishing' },
  { value: 'handover', label: 'Handover' },
];

// Selectable building types, aligned with the Dutch Bbl "gebruiksfuncties".
// Neutral English fallback labels — overlaid by `useWizardOptions.ts` with the
// country/locale-specific labels from GET /jurisdictions. The legacy
// `commercial` code stays valid for existing projects (see `BuildingTypeEnum`)
// but is intentionally NOT offered here — it's superseded by office/retail/
// industrial.
export const BUILDING_TYPE_OPTIONS: readonly {
  value: BuildingTypeValue;
  label: string;
}[] = [
  { value: 'dwelling', label: 'Dwelling' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'cell', label: 'Cell (detention)' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'office', label: 'Office' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'education', label: 'Education' },
  { value: 'sport', label: 'Sport' },
  { value: 'retail', label: 'Retail' },
  { value: 'non_building', label: 'Non-building structure' },
  { value: 'other', label: 'Other' },
];

/** Stable step identifiers — used for React keys and step lookup. The
 * `members` step is create-only (existing projects manage their team on the
 * access page), so it never appears in edit mode. */
export type ProjectWizardStepId = 'basics' | 'address' | 'details' | 'members';

/** Field names per step, used to scope `form.trigger([...])` validation. The
 * `members` step holds no RHF fields — its team list is lifted state in the
 * dialog and gated separately (see `ProjectFormDialog`). */
export const PROJECT_WIZARD_STEP_FIELDS: Record<
  ProjectWizardStepId,
  readonly (keyof ProjectFormValues)[]
> = {
  basics: ['name', 'description'],
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
  details: [
    'reference_code',
    'phase',
    'building_type',
    'planned_start_date',
    'delivery_date',
    'permit_number',
  ],
  members: [],
} as const;

/** Steps shown when editing an existing project (no team step). */
export const PROJECT_WIZARD_STEPS: readonly (WizardStep & { id: ProjectWizardStepId })[] = [
  {
    id: 'basics',
    title: 'Basics',
    description: 'Name and description',
  },
  {
    id: 'address',
    title: 'Address',
    description: 'Site location',
  },
  {
    id: 'details',
    title: 'Details',
    description: 'Building info, dates, instrument',
  },
] as const;

/** Steps shown when creating a project — the edit steps plus the Team step,
 * where the creator adds at least one other org user / email invite. */
export const PROJECT_CREATE_WIZARD_STEPS: readonly (WizardStep & { id: ProjectWizardStepId })[] = [
  ...PROJECT_WIZARD_STEPS,
  {
    id: 'members',
    title: 'Team',
    description: 'Add people to the project',
  },
] as const;
