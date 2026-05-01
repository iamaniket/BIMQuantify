import type { WizardStep } from '@bimstitch/ui';

import type { ProjectPhaseValue, ProjectStatusValue } from '@/lib/api/schemas';

import type { ProjectFormValues } from '../projectFormSchema';

export const STATUS_OPTIONS: readonly { value: ProjectStatusValue; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'ontwerp', label: 'Ontwerp (Design)' },
  { value: 'vergunning', label: 'Vergunning (Permit)' },
  { value: 'uitvoering', label: 'Uitvoering (Execution)' },
  { value: 'oplevering', label: 'Oplevering (Delivery)' },
  { value: 'gereed', label: 'Gereed (Completed)' },
  { value: 'on_hold', label: 'On hold' },
];

export const PHASE_OPTIONS: readonly { value: ProjectPhaseValue; label: string }[] = [
  { value: 'ontwerp', label: 'Ontwerp' },
  { value: 'bestek', label: 'Bestek' },
  { value: 'werkvoorbereiding', label: 'Werkvoorbereiding' },
  { value: 'ruwbouw', label: 'Ruwbouw' },
  { value: 'afbouw', label: 'Afbouw' },
  { value: 'oplevering', label: 'Oplevering' },
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
