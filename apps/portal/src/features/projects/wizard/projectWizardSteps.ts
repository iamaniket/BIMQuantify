import type { WizardStep } from '@bimstitch/ui';

import type { ProjectPhaseValue, ProjectStatusValue } from '@/lib/api/schemas';

import type { ProjectFormValues } from '../projectFormSchema';

// Labels are the Dutch construction-industry terms — kept as the only
// locale for NL projects today. Other jurisdictions will ship their own
// translations once i18n message catalogs cover the wizard.
export const STATUS_OPTIONS: readonly { value: ProjectStatusValue; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'design', label: 'Ontwerp (Design)' },
  { value: 'permit_review', label: 'Vergunning (Permit)' },
  { value: 'construction', label: 'Uitvoering (Execution)' },
  { value: 'handover', label: 'Oplevering (Delivery)' },
  { value: 'complete', label: 'Gereed (Completed)' },
  { value: 'on_hold', label: 'On hold' },
];

export const PHASE_OPTIONS: readonly { value: ProjectPhaseValue; label: string }[] = [
  { value: 'design', label: 'Ontwerp' },
  { value: 'tender', label: 'Bestek' },
  { value: 'work_prep', label: 'Werkvoorbereiding' },
  { value: 'shell', label: 'Ruwbouw' },
  { value: 'finishing', label: 'Afbouw' },
  { value: 'handover', label: 'Oplevering' },
];

/** Stable step identifiers — used for React keys and step lookup. */
export type ProjectWizardStepId = 'basics' | 'details' | 'address' | 'contractor';

/** Field names per step, used to scope `form.trigger([...])` validation. */
export const PROJECT_WIZARD_STEP_FIELDS: Record<
  ProjectWizardStepId,
  readonly (keyof ProjectFormValues)[]
> = {
  basics: ['name', 'description'],
  details: ['reference_code', 'status', 'phase', 'delivery_date', 'permit_number'],
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
