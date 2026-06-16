'use client';

import { ChevronDown, ChevronUp, Plus, Trash2, Upload } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@bimstitch/ui';

import { Wizard, type WizardStep } from '@/components/shared/wizard/Wizard';
import { ApiError } from '@/lib/api/client';
import { uploadTemplateAssetEnd2End } from '@/lib/api/reportTemplates';
import {
  FindingTemplateCreateSchema,
  FindingTemplateUpdateSchema,
  MAX_TEMPLATE_FIELDS,
  TEMPLATABLE_BUILTINS,
  type FieldDef,
  type FindingFieldTypeValue,
  type FindingTemplate,
} from '@/lib/api/schemas';
import { REPORT_TEMPLATE_TYPES, type ReportTemplate } from '@/lib/api/schemas/reportTemplates';
import { useAuth } from '@/providers/AuthProvider';

import { FIELD_TYPE_ORDER } from '../findingTemplates/fieldTypes';
import { useCreateFindingTemplate } from '../findingTemplates/useCreateFindingTemplate';
import { useUpdateFindingTemplate } from '../findingTemplates/useUpdateFindingTemplate';
import {
  useCreateReportTemplate,
  useReportTemplateSchema,
  useUpdateReportTemplate,
} from '../reportTemplates/hooks';

import type { UnifiedTemplateRow } from './useAllTemplates';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TemplateCategory = 'finding' | 'report';

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

type ContentEntry = {
  kind: 'content';
  key: string;
  enabled: boolean;
  titleOverride: string;
};
type TextEntry = { kind: 'text'; id: string; title: string; body: string };
type SectionEntry = ContentEntry | TextEntry;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: UnifiedTemplateRow | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const BUILTIN_KEYS = TEMPLATABLE_BUILTINS;
const KNOWN_ERROR_CODE = /^[A-Z_]+(:.*)?$/;

function makeId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${s}`;
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

/* ------------------------------------------------------------------ */
/*  Step definitions                                                   */
/* ------------------------------------------------------------------ */

type StepId = 'type' | 'setup' | 'fields' | 'branding' | 'content';

const FINDING_STEPS: readonly (WizardStep & { id: StepId })[] = [
  { id: 'type', title: 'Type' },
  { id: 'setup', title: 'Setup' },
  { id: 'fields', title: 'Custom fields' },
] as const;

const REPORT_STEPS: readonly (WizardStep & { id: StepId })[] = [
  { id: 'type', title: 'Type' },
  { id: 'setup', title: 'Setup' },
  { id: 'branding', title: 'Branding' },
  { id: 'content', title: 'Content' },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OrgTemplateBuilderDialog({ open, onOpenChange, editTarget }: Props): JSX.Element {
  const t = useTranslations('orgTemplates');
  const tFinding = useTranslations('findingTemplates');
  const tFindingTypes = useTranslations('findingTemplates.fieldTypes');
  const tBuiltins = useTranslations('findingTemplates.builtins');
  const tReport = useTranslations('reportTemplates');
  const locale = useLocale();
  const { tokens } = useAuth();

  // ---- Type selection state ----
  const [category, setCategory] = useState<TemplateCategory>('finding');
  const [reportType, setReportType] = useState<string>(REPORT_TEMPLATE_TYPES[0]);

  // ---- Shared state ----
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Finding-specific state ----
  const [builtins, setBuiltins] = useState<BuiltinState>(defaultBuiltins);
  const [fields, setFields] = useState<BuilderField[]>([]);

  // ---- Report-specific state ----
  const [accent, setAccent] = useState('#1d4ed8');
  const [accentSecondary, setAccentSecondary] = useState('#0ea5e9');
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'logo' | 'cover_pdf' | null>(null);
  const [sections, setSections] = useState<SectionEntry[]>([]);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  // ---- Wizard state ----
  const [currentStep, setCurrentStep] = useState(0);
  const [highestVisited, setHighestVisited] = useState(0);

  // ---- Mutations ----
  const createFinding = useCreateFindingTemplate();
  const updateFinding = useUpdateFindingTemplate();
  const createReport = useCreateReportTemplate(reportType);
  const updateReport = useUpdateReportTemplate(reportType);
  const schemaQuery = useReportTemplateSchema(reportType, locale);

  const isEditing = editTarget !== null;
  const pending =
    createFinding.isPending ||
    updateFinding.isPending ||
    createReport.isPending ||
    updateReport.isPending;

  // ---- Report schema helpers ----
  const sectionLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of schemaQuery.data?.sections ?? []) map.set(s.key, s.label);
    return map;
  }, [schemaQuery.data]);
  const mergeFields = schemaQuery.data?.merge_fields ?? [];

  // ---- Dynamic steps ----
  const rawSteps = category === 'finding' ? FINDING_STEPS : REPORT_STEPS;
  const wizardSteps = useMemo(
    () =>
      rawSteps.map((step) => ({
        ...step,
        title: t(`builder.steps.${step.id}.title` as Parameters<typeof t>[0]),
        description: t(`builder.steps.${step.id}.description` as Parameters<typeof t>[0]),
      })),
    [rawSteps, t],
  );
  const activeStepId = rawSteps[currentStep]?.id ?? 'type';

  // ---- Reset on open / edit target change ----
  useEffect(() => {
    if (!open) return;
    const schemaSections = schemaQuery.data?.sections ?? [];

    if (editTarget !== null) {
      if (editTarget.kind === 'finding') {
        const tmpl = editTarget.data;
        setCategory('finding');
        setName(tmpl.name);
        setDescription(tmpl.description ?? '');
        setIsDefault(tmpl.is_default);
        setBuiltins(builtinsFromTemplate(tmpl.builtin_fields));
        setFields(tmpl.fields.map(fromFieldDef));
        setHighestVisited(FINDING_STEPS.length - 1);
      } else {
        const tmpl = editTarget.data;
        const cfg = tmpl.config;
        setCategory('report');
        setReportType(tmpl.template_type);
        setName(tmpl.name);
        setDescription(tmpl.description ?? '');
        setIsDefault(tmpl.is_default);
        setAccent(cfg.branding.accent_color ?? '#1d4ed8');
        setAccentSecondary(cfg.branding.accent_color_secondary ?? '#0ea5e9');
        setHeaderText(cfg.branding.header_text ?? '');
        setFooterText(cfg.branding.footer_text ?? '');
        setLogoKey(cfg.branding.logo_storage_key ?? null);
        setLogoPreview(null);
        setCoverKey(cfg.branding.cover_pdf_storage_key ?? null);
        setCoverName(
          cfg.branding.cover_pdf_storage_key
            ? cfg.branding.cover_pdf_storage_key.split('/').pop() ?? null
            : null,
        );
        const stored: SectionEntry[] = cfg.sections.map((s) =>
          s.type === 'content'
            ? { kind: 'content', key: s.key, enabled: s.enabled, titleOverride: s.title_override ?? '' }
            : { kind: 'text', id: s.id, title: s.title ?? '', body: s.body },
        );
        setSections(
          stored.length > 0
            ? stored
            : schemaSections.map((s) => ({ kind: 'content', key: s.key, enabled: true, titleOverride: '' })),
        );
        setHighestVisited(REPORT_STEPS.length - 1);
      }
      setCurrentStep(1);
    } else {
      setCategory('finding');
      setReportType(REPORT_TEMPLATE_TYPES[0]);
      setName('');
      setDescription('');
      setIsDefault(false);
      setBuiltins(defaultBuiltins());
      setFields([]);
      setAccent('#1d4ed8');
      setAccentSecondary('#0ea5e9');
      setHeaderText('');
      setFooterText('');
      setLogoKey(null);
      setLogoPreview(null);
      setCoverKey(null);
      setCoverName(null);
      setSections(
        schemaSections.map((s) => ({ kind: 'content', key: s.key, enabled: true, titleOverride: '' })),
      );
      setCurrentStep(0);
      setHighestVisited(0);
    }
    setError(null);
    createFinding.reset();
    updateFinding.reset();
    createReport.reset();
    updateReport.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTarget, schemaQuery.data]);

  // ---- Category change resets type-specific state ----
  const handleCategoryChange = (next: TemplateCategory): void => {
    if (isEditing) return;
    setCategory(next);
    setHighestVisited(0);
    setError(null);
    if (next === 'finding') {
      setBuiltins(defaultBuiltins());
      setFields([]);
    } else {
      const schemaSections = schemaQuery.data?.sections ?? [];
      setAccent('#1d4ed8');
      setAccentSecondary('#0ea5e9');
      setHeaderText('');
      setFooterText('');
      setLogoKey(null);
      setLogoPreview(null);
      setCoverKey(null);
      setCoverName(null);
      setSections(
        schemaSections.map((s) => ({ kind: 'content', key: s.key, enabled: true, titleOverride: '' })),
      );
    }
  };

  // ---- Finding field helpers ----
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
      { id: makeId('f'), type: 'text', label: '', required: false, helpText: '', optionsText: '', min: '', max: '' },
    ]);
  };
  const removeField = (index: number): void => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  // ---- Report section helpers ----
  const moveSection = (index: number, delta: number): void => {
    setSections((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target] as SectionEntry, next[index] as SectionEntry];
      return next;
    });
  };
  const patchSection = (index: number, patch: Partial<ContentEntry> & Partial<TextEntry>): void => {
    setSections((prev) => prev.map((s, i) => (i === index ? ({ ...s, ...patch } as SectionEntry) : s)));
  };
  const addTextBlock = (): void => {
    setSections((prev) => [...prev, { kind: 'text', id: makeId('t'), title: '', body: '' }]);
  };
  const removeSection = (index: number): void => {
    setSections((prev) => prev.filter((_, i) => i !== index));
  };
  const insertMergeField = (index: number, path: string): void => {
    setSections((prev) =>
      prev.map((s, i) =>
        i === index && s.kind === 'text' ? { ...s, body: `${s.body}{{${path}}}` } : s,
      ),
    );
  };

  // ---- Report upload ----
  const handleUpload = async (kind: 'logo' | 'cover_pdf', file: File): Promise<void> => {
    const token = tokens?.access_token;
    if (token === undefined) return;
    setUploading(kind);
    setError(null);
    try {
      const res = await uploadTemplateAssetEnd2End(token, kind, file);
      if (kind === 'logo') {
        setLogoKey(res.storage_key);
        setLogoPreview(res.url);
      } else {
        setCoverKey(res.storage_key);
        setCoverName(file.name);
      }
    } catch {
      setError(tReport('builder.uploadFailed'));
    } finally {
      setUploading(null);
    }
  };

  // ---- Wizard navigation ----
  const handleNext = useCallback((): void => {
    if (currentStep === 0) {
      // type step — no validation needed
    } else if (name.trim() === '') {
      return;
    }
    const next = Math.min(rawSteps.length - 1, currentStep + 1);
    setCurrentStep(next);
    setHighestVisited((prev) => Math.max(prev, next));
  }, [currentStep, name, rawSteps.length]);

  const handleBack = useCallback((): void => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStepChange = useCallback(
    (next: number): void => {
      if (next > highestVisited || next === currentStep) return;
      setCurrentStep(next);
    },
    [highestVisited, currentStep],
  );

  // ---- Build report config ----
  const buildReportConfig = useCallback(() => {
    return {
      branding: {
        logo_storage_key: logoKey,
        accent_color: accent,
        accent_color_secondary: accentSecondary,
        header_text: headerText.trim() === '' ? null : headerText.trim(),
        footer_text: footerText.trim() === '' ? null : footerText.trim(),
        cover_pdf_storage_key: coverKey,
      },
      sections: sections
        .filter((s) => s.kind === 'content' || s.body.trim() !== '')
        .map((s) =>
          s.kind === 'content'
            ? {
                type: 'content' as const,
                key: s.key,
                enabled: s.enabled,
                title_override: s.titleOverride.trim() === '' ? null : s.titleOverride.trim(),
              }
            : {
                type: 'text' as const,
                id: s.id,
                title: s.title.trim() === '' ? null : s.title.trim(),
                body: s.body,
                enabled: true,
              },
        ),
      options: { show_toc: true, signature_label: null },
    };
  }, [accent, accentSecondary, coverKey, footerText, headerText, logoKey, sections]);

  // ---- Submit ----
  function friendlyFindingError(code: string | undefined): string {
    if (code !== undefined && /^[A-Z_]+$/.test(code)) {
      return tFinding(`errors.${code}`);
    }
    return tFinding('builder.checkFields');
  }

  function friendlyReportError(code: string | undefined): string {
    if (code !== undefined && KNOWN_ERROR_CODE.test(code)) {
      const key = code.split(':')[0] ?? code;
      return tReport.has(`errors.${key}`) ? tReport(`errors.${key}`) : tReport('builder.checkFields');
    }
    return tReport('builder.checkFields');
  }

  const handleSubmit = useCallback(async (): Promise<void> => {
    setError(null);
    const trimmedDesc = description.trim();

    if (category === 'finding') {
      const builtinPayload = Object.fromEntries(
        BUILTIN_KEYS.map((key) => [key, builtins[key] ?? { visible: true, required: false }]),
      );
      const fieldsPayload = fields.map(toFieldDef);

      if (isEditing && editTarget !== null) {
        const parsed = FindingTemplateUpdateSchema.safeParse({
          name: name.trim(),
          description: trimmedDesc === '' ? null : trimmedDesc,
          builtin_fields: builtinPayload,
          fields: fieldsPayload,
        });
        if (!parsed.success) {
          setError(friendlyFindingError(parsed.error.issues[0]?.message));
          return;
        }
        updateFinding.mutate(
          { id: editTarget.data.id, input: parsed.data },
          { onSuccess: () => { toast.success(tFinding('builder.updateSuccess')); onOpenChange(false); } },
        );
        return;
      }

      const parsed = FindingTemplateCreateSchema.safeParse({
        name: name.trim(),
        description: trimmedDesc === '' ? null : trimmedDesc,
        builtin_fields: builtinPayload,
        fields: fieldsPayload,
        is_default: isDefault,
      });
      if (!parsed.success) {
        setError(friendlyFindingError(parsed.error.issues[0]?.message));
        return;
      }
      createFinding.mutate(parsed.data, {
        onSuccess: () => { toast.success(tFinding('builder.createSuccess')); onOpenChange(false); },
      });
    } else {
      if (name.trim() === '') {
        setError(tReport('errors.NAME_REQUIRED'));
        return;
      }
      const config = buildReportConfig();
      const onError = (err: Error): void => {
        setError(err instanceof ApiError ? friendlyReportError(err.detail ?? undefined) : tReport('builder.checkFields'));
      };

      if (isEditing && editTarget !== null) {
        updateReport.mutate(
          { id: editTarget.data.id, input: { name: name.trim(), description: trimmedDesc === '' ? null : trimmedDesc, config } },
          {
            onSuccess: () => { toast.success(tReport('builder.updateSuccess')); onOpenChange(false); },
            onError,
          },
        );
        return;
      }

      createReport.mutate(
        {
          template_type: reportType,
          name: name.trim(),
          description: trimmedDesc === '' ? null : trimmedDesc,
          is_default: isDefault,
          config,
        },
        {
          onSuccess: () => { toast.success(tReport('builder.createSuccess')); onOpenChange(false); },
          onError,
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildReportConfig, builtins, category, description, editTarget, fields, isDefault, isEditing, name, onOpenChange, reportType]);

  // ---- Render ----
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[calc(100vh-48px)]"
        style={{ height: category === 'report' ? 600 : 560 }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('builder.editTitle') : t('builder.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('builder.subtitle')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
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
            cancelSlot={
              <DialogClose asChild>
                <Button type="button" variant="border" size="md" disabled={pending}>
                  {t('builder.cancel')}
                </Button>
              </DialogClose>
            }
            errorSlot={
              error !== null ? (
                <p className="font-sans text-body3 text-error" role="alert">{error}</p>
              ) : null
            }
          >
            {/* ---- Step: Type selection ---- */}
            {activeStepId === 'type' && (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  disabled={isEditing}
                  onClick={() => { handleCategoryChange('finding'); }}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    category === 'finding'
                      ? 'border-primary bg-primary-lighter'
                      : 'border-border bg-background hover:bg-background-hover'
                  } ${isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <div className="font-sans text-body2 font-medium text-foreground">
                    {t('chooser.findingOption')}
                  </div>
                  <div className="mt-0.5 font-sans text-caption text-foreground-tertiary">
                    {t('chooser.findingDesc')}
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isEditing}
                  onClick={() => { handleCategoryChange('report'); }}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    category === 'report'
                      ? 'border-primary bg-primary-lighter'
                      : 'border-border bg-background hover:bg-background-hover'
                  } ${isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <div className="font-sans text-body2 font-medium text-foreground">
                    {t('chooser.reportOption')}
                  </div>
                  <div className="mt-0.5 font-sans text-caption text-foreground-tertiary">
                    {t('chooser.reportDesc')}
                  </div>
                </button>

                {category === 'report' && (
                  <div className="mt-1">
                    <label className="mb-1 block font-sans text-caption font-medium text-foreground-secondary">
                      {t('chooser.reportTypeLabel')}
                    </label>
                    <Select
                      selectSize="md"
                      value={reportType}
                      disabled={isEditing}
                      onChange={(e) => { setReportType(e.target.value); }}
                    >
                      {REPORT_TEMPLATE_TYPES.map((rt) => (
                        <option key={rt} value={rt}>
                          {tReport(`reportTypes.${rt}` as Parameters<typeof tReport>[0])}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* ---- Step: Setup ---- */}
            {activeStepId === 'setup' && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tmpl-name">
                      {category === 'finding' ? tFinding('builder.nameLabel') : tReport('builder.nameLabel')}
                    </Label>
                    <Input
                      id="tmpl-name"
                      autoFocus
                      placeholder={category === 'finding' ? tFinding('builder.namePlaceholder') : tReport('builder.namePlaceholder')}
                      value={name}
                      onChange={(e) => { setName(e.target.value); }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tmpl-desc">
                      {category === 'finding' ? tFinding('builder.descriptionLabel') : tReport('builder.descriptionLabel')}
                    </Label>
                    <Textarea
                      id="tmpl-desc"
                      rows={2}
                      placeholder={category === 'finding' ? tFinding('builder.descriptionPlaceholder') : undefined}
                      value={description}
                      onChange={(e) => { setDescription(e.target.value); }}
                    />
                  </div>
                  {!isEditing && (
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-low px-3 py-2">
                      <span className="flex flex-col">
                        <span className="font-sans text-body3 font-medium text-foreground">
                          {category === 'finding' ? tFinding('builder.defaultLabel') : tReport('builder.defaultLabel')}
                        </span>
                        <span className="font-sans text-caption text-foreground-tertiary">
                          {category === 'finding' ? tFinding('builder.defaultHint') : tReport('builder.defaultHint')}
                        </span>
                      </span>
                      <Switch checked={isDefault} onChange={(e) => { setIsDefault(e.target.checked); }} />
                    </label>
                  )}
                </div>

                {/* Built-in fields (finding only) */}
                {category === 'finding' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-sans text-label2 font-semibold text-foreground">{tFinding('builder.builtinsTitle')}</span>
                      <span className="font-sans text-caption text-foreground-tertiary">{tFinding('builder.lockedFieldsNote')}</span>
                    </div>
                    <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                      {BUILTIN_KEYS.map((key) => {
                        const cfg = builtins[key] ?? { visible: true, required: false };
                        return (
                          <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="font-sans text-body3 text-foreground">{tBuiltins(key)}</span>
                            <div className="flex items-center gap-4">
                              <label className="flex items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                                {tFinding('builder.show')}
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
                                {tFinding('builder.required')}
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
                )}
              </div>
            )}

            {/* ---- Step: Custom fields (finding only) ---- */}
            {activeStepId === 'fields' && (
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
            )}

            {/* ---- Step: Branding (report only) ---- */}
            {activeStepId === 'branding' && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rt-accent">{tReport('builder.accentLabel')}</Label>
                    <input
                      id="rt-accent"
                      type="color"
                      value={accent}
                      onChange={(e) => { setAccent(e.target.value); }}
                      className="h-9 w-full cursor-pointer rounded-md border border-border bg-background"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rt-accent2">{tReport('builder.accentSecondaryLabel')}</Label>
                    <input
                      id="rt-accent2"
                      type="color"
                      value={accentSecondary}
                      onChange={(e) => { setAccentSecondary(e.target.value); }}
                      className="h-9 w-full cursor-pointer rounded-md border border-border bg-background"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rt-header">{tReport('builder.headerLabel')}</Label>
                  <Input id="rt-header" value={headerText} onChange={(e) => { setHeaderText(e.target.value); }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rt-footer">{tReport('builder.footerLabel')}</Label>
                  <Input id="rt-footer" value={footerText} onChange={(e) => { setFooterText(e.target.value); }} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{tReport('builder.logoLabel')}</Label>
                    <input
                      ref={logoInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUpload('logo', f);
                      }}
                    />
                    <Button
                      type="button"
                      variant="border"
                      size="md"
                      disabled={uploading !== null}
                      onClick={() => logoInput.current?.click()}
                    >
                      {uploading === 'logo' ? <Spinner className="mr-1.5 h-3 w-3" /> : <Upload className="mr-1.5 h-3 w-3" />}
                      {logoKey !== null ? tReport('builder.replace') : tReport('builder.upload')}
                    </Button>
                    {logoPreview !== null ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreview} alt="" className="mt-1 h-10 w-auto self-start rounded border border-border" />
                    ) : logoKey !== null ? (
                      <Badge variant="success" size="md">{tReport('builder.uploaded')}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{tReport('builder.coverLabel')}</Label>
                    <input
                      ref={coverInput}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUpload('cover_pdf', f);
                      }}
                    />
                    <Button
                      type="button"
                      variant="border"
                      size="md"
                      disabled={uploading !== null}
                      onClick={() => coverInput.current?.click()}
                    >
                      {uploading === 'cover_pdf' ? <Spinner className="mr-1.5 h-3 w-3" /> : <Upload className="mr-1.5 h-3 w-3" />}
                      {coverKey !== null ? tReport('builder.replace') : tReport('builder.upload')}
                    </Button>
                    {coverName !== null ? (
                      <span className="truncate font-sans text-caption text-foreground-tertiary">{coverName}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* ---- Step: Content (report only) ---- */}
            {activeStepId === 'content' && (
              <div className="flex flex-col gap-2">
                <span className="font-sans text-caption text-foreground-tertiary">{tReport('builder.contentHint')}</span>
                <div className="flex flex-col gap-2">
                  {sections.map((s, index) => (
                    <div key={s.kind === 'content' ? s.key : s.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                      <div className="flex items-center gap-2">
                        {s.kind === 'content' ? (
                          <>
                            <Switch checked={s.enabled} onChange={(e) => { patchSection(index, { enabled: e.target.checked }); }} />
                            <span className="font-sans text-body3 font-medium text-foreground">{sectionLabels.get(s.key) ?? s.key}</span>
                            <Input
                              className="ml-auto w-40"
                              placeholder={tReport('builder.titleOverridePlaceholder')}
                              value={s.titleOverride}
                              onChange={(e) => { patchSection(index, { titleOverride: e.target.value }); }}
                            />
                          </>
                        ) : (
                          <>
                            <Badge variant="info" size="md">{tReport('builder.textBlock')}</Badge>
                            <Input
                              className="ml-1 flex-1"
                              placeholder={tReport('builder.textTitlePlaceholder')}
                              value={s.title}
                              onChange={(e) => { patchSection(index, { title: e.target.value }); }}
                            />
                          </>
                        )}
                        <div className="flex shrink-0 items-center">
                          <IconButton size="sm" aria-label={tReport('builder.moveUp')} disabled={index === 0} onClick={() => { moveSection(index, -1); }}>
                            <ChevronUp className="h-4 w-4" />
                          </IconButton>
                          <IconButton size="sm" aria-label={tReport('builder.moveDown')} disabled={index === sections.length - 1} onClick={() => { moveSection(index, 1); }}>
                            <ChevronDown className="h-4 w-4" />
                          </IconButton>
                          {s.kind === 'text' ? (
                            <IconButton size="sm" aria-label={tReport('builder.remove')} className="hover:text-error" onClick={() => { removeSection(index); }}>
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          ) : null}
                        </div>
                      </div>
                      {s.kind === 'text' ? (
                        <div className="flex flex-col gap-1.5">
                          <Textarea
                            rows={3}
                            placeholder={tReport('builder.textBodyPlaceholder')}
                            value={s.body}
                            onChange={(e) => { patchSection(index, { body: e.target.value }); }}
                          />
                          {mergeFields.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {mergeFields.map((mf) => (
                                <button
                                  key={mf.path}
                                  type="button"
                                  onClick={() => { insertMergeField(index, mf.path); }}
                                  className="rounded border border-border bg-surface-low px-1.5 py-0.5 font-sans text-caption text-foreground-secondary transition-colors hover:bg-background-hover"
                                >
                                  {mf.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addTextBlock}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 font-sans text-body3 text-foreground-secondary transition-colors hover:bg-background-hover"
                >
                  <Plus className="h-4 w-4" />
                  {tReport('builder.addTextBlock')}
                </button>
              </div>
            )}
          </Wizard>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
