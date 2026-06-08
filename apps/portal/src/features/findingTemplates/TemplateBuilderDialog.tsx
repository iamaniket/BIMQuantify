'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Switch,
  Textarea,
} from '@bimstitch/ui';

import { Wizard, type WizardStep } from '@/components/shared/wizard/Wizard';
import {
  FindingTemplateCreateSchema,
  FindingTemplateUpdateSchema,
  MAX_TEMPLATE_FIELDS,
  TEMPLATABLE_BUILTINS,
  type FieldDef,
  type FindingFieldTypeValue,
  type FindingTemplate,
} from '@/lib/api/schemas';

import { FIELD_TYPE_ORDER } from './fieldTypes';
import { useCreateFindingTemplate } from './useCreateFindingTemplate';
import { useUpdateFindingTemplate } from './useUpdateFindingTemplate';

type BuilderField = {
  id: string;
  type: FindingFieldTypeValue;
  label: string;
  required: boolean;
  helpText: string;
  optionsText: string;
  min: string;
  max: string;
};

type BuiltinState = Record<string, { visible: boolean; required: boolean }>;

type TemplateStepId = 'setup' | 'fields';

const STEPS: readonly (WizardStep & { id: TemplateStepId })[] = [
  { id: 'setup', title: 'Setup', description: 'Name and standard fields' },
  { id: 'fields', title: 'Custom fields', description: 'Add your own fields' },
] as const;

const BUILTIN_KEYS = TEMPLATABLE_BUILTINS;
const KNOWN_ERROR_CODE = /^[A-Z_]+$/;

const ICON_BTN =
  'inline-grid h-7 w-7 place-items-center rounded text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent';

function makeFieldId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return `f_${s}`;
}

function defaultBuiltins(): BuiltinState {
  return Object.fromEntries(
    BUILTIN_KEYS.map((key) => [key, { visible: true, required: false }]),
  );
}

function builtinsFromTemplate(stored: FindingTemplate['builtin_fields']): BuiltinState {
  const base = defaultBuiltins();
  for (const key of BUILTIN_KEYS) {
    const entry = stored[key];
    if (entry !== undefined) base[key] = { visible: entry.visible, required: entry.required };
  }
  return base;
}

function fromFieldDef(f: FieldDef): BuilderField {
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

function toFieldDef(bf: BuilderField): Record<string, unknown> {
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: FindingTemplate | null;
};

export function TemplateBuilderDialog({ open, onOpenChange, template }: Props): JSX.Element {
  const t = useTranslations('findingTemplates');
  const tTypes = useTranslations('findingTemplates.fieldTypes');
  const tBuiltins = useTranslations('findingTemplates.builtins');
  const createMutation = useCreateFindingTemplate();
  const updateMutation = useUpdateFindingTemplate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [builtins, setBuiltins] = useState<BuiltinState>(defaultBuiltins);
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [highestVisited, setHighestVisited] = useState(0);

  const isEditing = template !== null;
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    if (template !== null) {
      setName(template.name);
      setDescription(template.description ?? '');
      setIsDefault(template.is_default);
      setBuiltins(builtinsFromTemplate(template.builtin_fields));
      setFields(template.fields.map(fromFieldDef));
      setHighestVisited(1);
    } else {
      setName('');
      setDescription('');
      setIsDefault(false);
      setBuiltins(defaultBuiltins());
      setFields([]);
      setHighestVisited(0);
    }
    setError(null);
    setCurrentStep(0);
    createMutation.reset();
    updateMutation.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template]);

  const updateField = (index: number, patch: Partial<BuilderField>): void => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const moveField = (index: number, delta: number): void => {
    setFields((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target] as BuilderField, next[index] as BuilderField];
      return next;
    });
  };

  const addField = (): void => {
    if (fields.length >= MAX_TEMPLATE_FIELDS) return;
    setFields((prev) => [
      ...prev,
      { id: makeFieldId(), type: 'text', label: '', required: false, helpText: '', optionsText: '', min: '', max: '' },
    ]);
  };

  const removeField = (index: number): void => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  function friendlyError(code: string | undefined): string {
    if (code !== undefined && KNOWN_ERROR_CODE.test(code)) {
      return t(`errors.${code}`);
    }
    return t('builder.checkFields');
  }

  const handleNext = useCallback(async (): Promise<void> => {
    if (name.trim() === '') return;
    const next = Math.min(STEPS.length - 1, currentStep + 1);
    setCurrentStep(next);
    setHighestVisited((prev) => Math.max(prev, next));
  }, [currentStep, name]);

  const handleBack = useCallback((): void => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStepChange = useCallback((next: number): void => {
    if (next > highestVisited) return;
    if (next === currentStep) return;
    setCurrentStep(next);
  }, [highestVisited, currentStep]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    setError(null);

    const builtinPayload = Object.fromEntries(
      BUILTIN_KEYS.map((key) => [key, builtins[key] ?? { visible: true, required: false }]),
    );
    const fieldsPayload = fields.map(toFieldDef);
    const trimmedDescription = description.trim();

    if (isEditing && template !== null) {
      const parsed = FindingTemplateUpdateSchema.safeParse({
        name: name.trim(),
        description: trimmedDescription === '' ? null : trimmedDescription,
        builtin_fields: builtinPayload,
        fields: fieldsPayload,
      });
      if (!parsed.success) {
        setError(friendlyError(parsed.error.issues[0]?.message));
        return;
      }
      updateMutation.mutate(
        { id: template.id, input: parsed.data },
        { onSuccess: () => { toast.success(t('builder.updateSuccess')); onOpenChange(false); } },
      );
      return;
    }

    const parsed = FindingTemplateCreateSchema.safeParse({
      name: name.trim(),
      description: trimmedDescription === '' ? null : trimmedDescription,
      builtin_fields: builtinPayload,
      fields: fieldsPayload,
      is_default: isDefault,
    });
    if (!parsed.success) {
      setError(friendlyError(parsed.error.issues[0]?.message));
      return;
    }
    createMutation.mutate(parsed.data, {
      onSuccess: () => { toast.success(t('builder.createSuccess')); onOpenChange(false); },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builtins, description, fields, isDefault, isEditing, name, onOpenChange, t, template]);

  const wizardSteps = STEPS.map((step) => ({
    ...step,
    title: t(`builder.steps.${step.id}.title`),
    description: t(`builder.steps.${step.id}.description`),
  }));

  const activeStepDef = STEPS[currentStep];
  const activeStepId = activeStepDef === undefined ? 'setup' : activeStepDef.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('builder.editTitle') : t('builder.createTitle')}</DialogTitle>
          <DialogDescription>{t('builder.subtitle')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-[420px]">
          <Wizard
            steps={wizardSteps}
            currentStep={currentStep}
            highestVisited={highestVisited}
            onStepChange={handleStepChange}
            onNext={handleNext}
            onBack={handleBack}
            onSubmit={handleSubmit}
            isSubmitting={pending}
            submitLabel={t('builder.save')}
            submitPendingLabel={t('builder.saving')}
            nextLabel={t('builder.next')}
            backLabel={t('builder.back')}
            cancelSlot={(
              <DialogClose asChild>
                <Button type="button" variant="border" size="md" disabled={pending}>
                  {t('builder.cancel')}
                </Button>
              </DialogClose>
            )}
            errorSlot={error !== null ? (
              <p className="font-sans text-body3 text-error" role="alert">
                {error}
              </p>
            ) : null}
          >
            {activeStepId === 'setup' && (
              <div className="flex flex-col gap-5">
                {/* Identity */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tmpl-name">{t('builder.nameLabel')}</Label>
                    <Input
                      id="tmpl-name"
                      autoFocus
                      placeholder={t('builder.namePlaceholder')}
                      value={name}
                      onChange={(e) => { setName(e.target.value); }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tmpl-desc">{t('builder.descriptionLabel')}</Label>
                    <Textarea
                      id="tmpl-desc"
                      rows={2}
                      placeholder={t('builder.descriptionPlaceholder')}
                      value={description}
                      onChange={(e) => { setDescription(e.target.value); }}
                    />
                  </div>
                  {!isEditing && (
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-low px-3 py-2">
                      <span className="flex flex-col">
                        <span className="font-sans text-body3 font-medium text-foreground">{t('builder.defaultLabel')}</span>
                        <span className="font-sans text-caption text-foreground-tertiary">{t('builder.defaultHint')}</span>
                      </span>
                      <Switch checked={isDefault} onChange={(e) => { setIsDefault(e.target.checked); }} />
                    </label>
                  )}
                </div>

                {/* Built-in fields */}
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-sans text-label2 font-semibold text-foreground">{t('builder.builtinsTitle')}</span>
                    <span className="font-sans text-caption text-foreground-tertiary">{t('builder.lockedFieldsNote')}</span>
                  </div>
                  <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {BUILTIN_KEYS.map((key) => {
                      const cfg = builtins[key] ?? { visible: true, required: false };
                      return (
                        <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="font-sans text-body3 text-foreground">{tBuiltins(key)}</span>
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                              {t('builder.show')}
                              <Switch
                                checked={cfg.visible}
                                onChange={(e) => {
                                  const visible = e.target.checked;
                                  setBuiltins((prev) => ({
                                    ...prev,
                                    [key]: { visible, required: visible ? cfg.required : false },
                                  }));
                                }}
                              />
                            </label>
                            <label className="flex items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                              {t('builder.required')}
                              <Switch
                                checked={cfg.required}
                                disabled={!cfg.visible}
                                onChange={(e) => {
                                  setBuiltins((prev) => ({ ...prev, [key]: { ...cfg, required: e.target.checked } }));
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeStepId === 'fields' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-label2 font-semibold text-foreground">{t('builder.customFieldsTitle')}</span>
                  <span className="font-sans text-caption text-foreground-tertiary tabular-nums">
                    {t('builder.fieldCount', { count: fields.length, max: MAX_TEMPLATE_FIELDS })}
                  </span>
                </div>

                <div className="flex max-h-[calc(60vh-120px)] min-h-0 flex-col gap-2 overflow-y-auto pr-1">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div className="flex items-center gap-2">
                        <Select
                          value={field.type}
                          onChange={(e) => {
                            updateField(index, { type: e.target.value as FindingFieldTypeValue });
                          }}
                          className="w-32 shrink-0"
                        >
                          {FIELD_TYPE_ORDER.map((type) => (
                            <option key={type} value={type}>
                              {tTypes(type)}
                            </option>
                          ))}
                        </Select>
                        <Input
                          placeholder={t('builder.fieldLabelPlaceholder')}
                          value={field.label}
                          onChange={(e) => { updateField(index, { label: e.target.value }); }}
                        />
                        <label className="flex shrink-0 items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                          {t('builder.required')}
                          <Switch
                            checked={field.required}
                            onChange={(e) => { updateField(index, { required: e.target.checked }); }}
                          />
                        </label>
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            title={t('builder.moveUp')}
                            className={ICON_BTN}
                            disabled={index === 0}
                            onClick={() => { moveField(index, -1); }}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={t('builder.moveDown')}
                            className={ICON_BTN}
                            disabled={index === fields.length - 1}
                            onClick={() => { moveField(index, 1); }}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={t('builder.removeField')}
                            className={`${ICON_BTN} hover:text-error`}
                            onClick={() => { removeField(index); }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {field.type === 'select' && (
                        <div className="flex flex-col gap-1">
                          <Label htmlFor={`opts-${field.id}`}>{t('builder.optionsLabel')}</Label>
                          <Textarea
                            id={`opts-${field.id}`}
                            rows={3}
                            placeholder={t('builder.optionsPlaceholder')}
                            value={field.optionsText}
                            onChange={(e) => { updateField(index, { optionsText: e.target.value }); }}
                          />
                          <span className="font-sans text-caption text-foreground-tertiary">{t('builder.optionsHint')}</span>
                        </div>
                      )}

                      {field.type === 'number' && (
                        <div className="flex items-center gap-3">
                          <div className="flex flex-1 flex-col gap-1">
                            <Label htmlFor={`min-${field.id}`}>{t('builder.minLabel')}</Label>
                            <Input
                              id={`min-${field.id}`}
                              type="number"
                              value={field.min}
                              onChange={(e) => { updateField(index, { min: e.target.value }); }}
                            />
                          </div>
                          <div className="flex flex-1 flex-col gap-1">
                            <Label htmlFor={`max-${field.id}`}>{t('builder.maxLabel')}</Label>
                            <Input
                              id={`max-${field.id}`}
                              type="number"
                              value={field.max}
                              onChange={(e) => { updateField(index, { max: e.target.value }); }}
                            />
                          </div>
                        </div>
                      )}

                      <Input
                        placeholder={t('builder.helpTextPlaceholder')}
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
                  {t('builder.addField')}
                </button>
              </div>
            )}
          </Wizard>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
