'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/client';
import { uploadTemplateAssetEnd2End } from '@/lib/api/reportTemplates';
import {
  FindingTemplateCreateSchema,
  FindingTemplateUpdateSchema,
  MAX_TEMPLATE_FIELDS,
} from '@/lib/api/schemas';
import { REPORT_TEMPLATE_TYPES } from '@/lib/api/schemas/reportTemplates';
import { useAuth } from '@/providers/AuthProvider';

import { useCreateFindingTemplate } from '../findingTemplates/useCreateFindingTemplate';
import { useUpdateFindingTemplate } from '../findingTemplates/useUpdateFindingTemplate';
import {
  useCreateReportTemplate,
  useReportTemplateSchema,
  useUpdateReportTemplate,
} from '../reportTemplates/hooks';

import {
  BUILTIN_KEYS,
  FINDING_STEPS,
  KNOWN_ERROR_CODE,
  REPORT_STEPS,
  builtinsFromTemplate,
  defaultBuiltins,
  fromFieldDef,
  makeId,
  toFieldDef,
  type BuilderField,
  type BuiltinState,
  type ContentEntry,
  type SectionEntry,
  type TemplateCategory,
  type TextEntry,
} from './orgTemplateBuilderTypes';

import type { UnifiedTemplateRow } from './useAllTemplates';

type UseOrgTemplateFormArgs = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: UnifiedTemplateRow | null;
};

export function useOrgTemplateForm({ open, onOpenChange, editTarget }: UseOrgTemplateFormArgs) {
  const t = useTranslations('orgTemplates');
  const tFinding = useTranslations('findingTemplates');
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
        title: t(`builder.steps.${step.id}.title`),
        description: t(`builder.steps.${step.id}.description`),
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
    setSections((prev) => prev.map((s, i) => (i === index ? ({ ...s, ...patch }) : s)));
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

  const handleSubmit = useCallback((): void => {
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

  return {
    // type selection
    category,
    reportType,
    setReportType,
    handleCategoryChange,
    // shared
    name,
    setName,
    description,
    setDescription,
    isDefault,
    setIsDefault,
    error,
    // finding
    builtins,
    setBuiltins,
    fields,
    updateField,
    moveField,
    addField,
    removeField,
    // report
    accent,
    setAccent,
    accentSecondary,
    setAccentSecondary,
    headerText,
    setHeaderText,
    footerText,
    setFooterText,
    logoKey,
    logoPreview,
    coverKey,
    coverName,
    uploading,
    sections,
    logoInput,
    coverInput,
    moveSection,
    patchSection,
    addTextBlock,
    removeSection,
    insertMergeField,
    handleUpload,
    // report schema helpers
    sectionLabels,
    mergeFields,
    // wizard
    currentStep,
    highestVisited,
    activeStepId,
    wizardSteps,
    handleNext,
    handleBack,
    handleStepChange,
    handleSubmit,
    // status
    isEditing,
    pending,
  };
}
