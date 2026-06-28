'use client';

import type { JSX } from 'react';

import { Input, Select, Switch, Textarea } from '@bimdossier/ui';

import type { FieldDef, FindingFieldTypeValue } from '@/lib/api/schemas';

// Order shown in the builder's type dropdown. Labels come from i18n
// (`findingTemplates.fieldTypes.<type>`).
export const FIELD_TYPE_ORDER: readonly FindingFieldTypeValue[] = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'checkbox',
] as const;

/**
 * Single source of truth mapping a custom field type → its input control.
 * Used by the dynamic finding form (`FindingFormDialog`). Number/date values
 * round-trip as strings; the API coerces + validates them server-side.
 */
export function renderFieldInput(args: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}): JSX.Element {
  const { field, value, onChange, id } = args;
  const stringValue = typeof value === 'string' ? value : '';

  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          id={id}
          rows={3}
          value={stringValue}
          onChange={(e) => { onChange(e.target.value); }}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(e) => { onChange(e.target.value); }}
          {...(field.min != null ? { min: field.min } : {})}
          {...(field.max != null ? { max: field.max } : {})}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={stringValue}
          onChange={(e) => { onChange(e.target.value); }}
        />
      );
    case 'select':
      return (
        <Select id={id} value={stringValue} onChange={(e) => { onChange(e.target.value); }}>
          <option value="">—</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      );
    case 'checkbox':
      return (
        <Switch
          id={id}
          checked={value === true}
          onChange={(e) => { onChange(e.target.checked); }}
        />
      );
    case 'text':
    default:
      return (
        <Input id={id} value={stringValue} onChange={(e) => { onChange(e.target.value); }} />
      );
  }
}
