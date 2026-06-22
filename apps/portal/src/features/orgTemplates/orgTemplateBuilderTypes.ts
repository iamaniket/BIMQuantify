import { type WizardStep } from '@/components/shared/wizard/Wizard';
import {
  TEMPLATABLE_BUILTINS,
  type FieldDef,
  type FindingFieldTypeValue,
  type FindingTemplate,
} from '@/lib/api/schemas';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TemplateCategory = 'finding' | 'report';

export type BuilderField = {
  id: string;
  type: FindingFieldTypeValue;
  label: string;
  required: boolean;
  helpText: string;
  optionsText: string;
  min: string;
  max: string;
};

export type BuiltinState = Record<string, { visible: boolean; required: boolean }>;

export type ContentEntry = {
  kind: 'content';
  key: string;
  enabled: boolean;
  titleOverride: string;
};
export type TextEntry = { kind: 'text'; id: string; title: string; body: string };
export type SectionEntry = ContentEntry | TextEntry;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export const BUILTIN_KEYS = TEMPLATABLE_BUILTINS;
export const KNOWN_ERROR_CODE = /^[A-Z_]+(:.*)?$/;

export function makeId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${s}`;
}

export function defaultBuiltins(): BuiltinState {
  return Object.fromEntries(
    BUILTIN_KEYS.map((key) => [key, { visible: true, required: false }]),
  );
}

export function builtinsFromTemplate(stored: FindingTemplate['builtin_fields']): BuiltinState {
  const base = defaultBuiltins();
  for (const key of BUILTIN_KEYS) {
    const entry = stored[key];
    if (entry !== undefined) base[key] = { visible: entry.visible, required: entry.required };
  }
  return base;
}

export function fromFieldDef(f: FieldDef): BuilderField {
  return {
    id: f.id,
    type: f.type,
    label: f.label,
    required: f.required,
    helpText: f.help_text ?? '',
    optionsText: (f.options ?? []).join('\n'),
    min: f.min != null ? String(f.min) : '',
    max: f.max != null ? String(f.max) : '',
  };
}

export function toFieldDef(bf: BuilderField): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: bf.id,
    type: bf.type,
    label: bf.label.trim(),
    required: bf.required,
  };
  if (bf.helpText.trim() !== '') out['help_text'] = bf.helpText.trim();
  if (bf.type === 'select') {
    out['options'] = bf.optionsText
      .split('\n')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }
  if (bf.type === 'number') {
    if (bf.min.trim() !== '') out['min'] = Number(bf.min);
    if (bf.max.trim() !== '') out['max'] = Number(bf.max);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Step definitions                                                   */
/* ------------------------------------------------------------------ */

export type StepId = 'type' | 'setup' | 'fields' | 'branding' | 'content';

export const FINDING_STEPS: readonly (WizardStep & { id: StepId })[] = [
  { id: 'type', title: 'Type' },
  { id: 'setup', title: 'Setup' },
  { id: 'fields', title: 'Custom fields' },
] as const;

export const REPORT_STEPS: readonly (WizardStep & { id: StepId })[] = [
  { id: 'type', title: 'Type' },
  { id: 'setup', title: 'Setup' },
  { id: 'branding', title: 'Branding' },
  { id: 'content', title: 'Content' },
] as const;
