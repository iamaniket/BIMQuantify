import type { ModelDisciplineValue, ModelStatusValue } from '@/lib/api/schemas';

export function formatDiscipline(value: ModelDisciplineValue): string {
  switch (value) {
    case 'architectural': return 'Architectural';
    case 'structural': return 'Structural';
    case 'mep': return 'MEP';
    case 'coordination': return 'Coordination';
    case 'other': return 'Other';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export function formatModelStatus(value: ModelStatusValue): string {
  switch (value) {
    case 'draft': return 'Draft';
    case 'active': return 'Active';
    case 'archived': return 'Archived';
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

export const DISCIPLINE_OPTIONS: readonly {
  value: ModelDisciplineValue;
  label: string;
}[] = [
  { value: 'architectural', label: 'Architectural' },
  { value: 'structural', label: 'Structural' },
  { value: 'mep', label: 'MEP' },
  { value: 'coordination', label: 'Coordination' },
  { value: 'other', label: 'Other' },
];

export const STATUS_OPTIONS: readonly {
  value: ModelStatusValue;
  label: string;
}[] = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];
