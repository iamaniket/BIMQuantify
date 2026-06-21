'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

import { IconButton, Input, Label, Select, Switch, Textarea } from '@bimstitch/ui';

import { MAX_TEMPLATE_FIELDS, type FindingFieldTypeValue } from '@/lib/api/schemas';

import { FIELD_TYPE_ORDER } from '../findingTemplates/fieldTypes';

import { type BuilderField } from './orgTemplateBuilderTypes';

type FieldsStepProps = {
  fields: BuilderField[];
  updateField: (index: number, patch: Partial<BuilderField>) => void;
  moveField: (index: number, delta: number) => void;
  addField: () => void;
  removeField: (index: number) => void;
};

export function FieldsStep({
  fields,
  updateField,
  moveField,
  addField,
  removeField,
}: FieldsStepProps): JSX.Element {
  const tFinding = useTranslations('findingTemplates');
  const tFindingTypes = useTranslations('findingTemplates.fieldTypes');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-sans text-label2 font-semibold text-foreground">{tFinding('builder.customFieldsTitle')}</span>
        <span className="font-sans text-caption text-foreground-tertiary tabular-nums">
          {tFinding('builder.fieldCount', { count: fields.length, max: MAX_TEMPLATE_FIELDS })}
        </span>
      </div>

      <div className="flex max-h-[calc(60vh-120px)] min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Select
                value={field.type}
                onChange={(e) => { updateField(index, { type: e.target.value as FindingFieldTypeValue }); }}
                className="w-32 shrink-0"
              >
                {FIELD_TYPE_ORDER.map((ft) => (
                  <option key={ft} value={ft}>{tFindingTypes(ft)}</option>
                ))}
              </Select>
              <Input
                placeholder={tFinding('builder.fieldLabelPlaceholder')}
                value={field.label}
                onChange={(e) => { updateField(index, { label: e.target.value }); }}
              />
              <label className="flex shrink-0 items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                {tFinding('builder.required')}
                <Switch
                  checked={field.required}
                  onChange={(e) => { updateField(index, { required: e.target.checked }); }}
                />
              </label>
              <div className="flex shrink-0 items-center">
                <IconButton size="sm" title={tFinding('builder.moveUp')} aria-label={tFinding('builder.moveUp')} disabled={index === 0} onClick={() => { moveField(index, -1); }}>
                  <ChevronUp className="h-4 w-4" />
                </IconButton>
                <IconButton size="sm" title={tFinding('builder.moveDown')} aria-label={tFinding('builder.moveDown')} disabled={index === fields.length - 1} onClick={() => { moveField(index, 1); }}>
                  <ChevronDown className="h-4 w-4" />
                </IconButton>
                <IconButton size="sm" title={tFinding('builder.removeField')} aria-label={tFinding('builder.removeField')} className="hover:text-error" onClick={() => { removeField(index); }}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>

            {field.type === 'select' && (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`opts-${field.id}`}>{tFinding('builder.optionsLabel')}</Label>
                <Textarea
                  id={`opts-${field.id}`}
                  rows={3}
                  placeholder={tFinding('builder.optionsPlaceholder')}
                  value={field.optionsText}
                  onChange={(e) => { updateField(index, { optionsText: e.target.value }); }}
                />
                <span className="font-sans text-caption text-foreground-tertiary">{tFinding('builder.optionsHint')}</span>
              </div>
            )}

            {field.type === 'number' && (
              <div className="flex items-center gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`min-${field.id}`}>{tFinding('builder.minLabel')}</Label>
                  <Input id={`min-${field.id}`} type="number" value={field.min} onChange={(e) => { updateField(index, { min: e.target.value }); }} />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`max-${field.id}`}>{tFinding('builder.maxLabel')}</Label>
                  <Input id={`max-${field.id}`} type="number" value={field.max} onChange={(e) => { updateField(index, { max: e.target.value }); }} />
                </div>
              </div>
            )}

            <Input
              placeholder={tFinding('builder.helpTextPlaceholder')}
              value={field.helpText}
              onChange={(e) => { updateField(index, { helpText: e.target.value }); }}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addField}
        disabled={fields.length >= MAX_TEMPLATE_FIELDS}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 font-sans text-body3 text-foreground-secondary transition-colors hover:bg-background-hover disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
        {tFinding('builder.addField')}
      </button>
    </div>
  );
}
