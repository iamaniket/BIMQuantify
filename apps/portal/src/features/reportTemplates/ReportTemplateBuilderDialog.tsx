'use client';

import { ChevronDown, ChevronUp, Plus, Trash2, Upload } from '@bimdossier/ui/icons';
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
  Spinner,
  Switch,
  Textarea,
} from '@bimdossier/ui';

import { Wizard, type WizardStep } from '@/components/shared/wizard/Wizard';
import { ApiError } from '@/lib/api/client';
import { uploadTemplateAssetEnd2End } from '@/lib/api/reportTemplates';
import type { ReportTemplate } from '@/lib/api/schemas/reportTemplates';
import { useAuth } from '@/providers/AuthProvider';

import { useCreateReportTemplate, useReportTemplateSchema, useUpdateReportTemplate } from './hooks';

type StepId = 'setup' | 'branding' | 'content';
const STEPS: readonly (WizardStep & { id: StepId })[] = [
  { id: 'setup', title: 'Setup', description: '' },
  { id: 'branding', title: 'Branding', description: '' },
  { id: 'content', title: 'Content', description: '' },
] as const;

const KNOWN_ERROR_CODE = /^[A-Z_]+(:.*)?$/;

type ContentEntry = {
  kind: 'content';
  key: string;
  enabled: boolean;
  titleOverride: string;
};
type TextEntry = { kind: 'text'; id: string; title: string; body: string };
type SectionEntry = ContentEntry | TextEntry;

function makeTextId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return `t_${s}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportType: string;
  template: ReportTemplate | null;
};

export function ReportTemplateBuilderDialog({
  open,
  onOpenChange,
  reportType,
  template,
}: Props): JSX.Element {
  const t = useTranslations('reportTemplates');
  const locale = useLocale();
  const { tokens } = useAuth();
  const schemaQuery = useReportTemplateSchema(reportType, locale);
  const createMutation = useCreateReportTemplate(reportType);
  const updateMutation = useUpdateReportTemplate(reportType);

  const sectionLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of schemaQuery.data?.sections ?? []) map.set(s.key, s.label);
    return map;
  }, [schemaQuery.data]);
  const mergeFields = schemaQuery.data?.merge_fields ?? [];

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
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
  const [error, setError] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [highestVisited, setHighestVisited] = useState(0);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const isEditing = template !== null;
  const pending = createMutation.isPending || updateMutation.isPending;

  // Reset form when (re)opened. For a new template, seed the section list from
  // the schema's content sections (all enabled, canonical order).
  useEffect(() => {
    if (!open) return;
    const schemaSections = schemaQuery.data?.sections ?? [];
    if (template !== null) {
      const cfg = template.config;
      setName(template.name);
      setDescription(template.description ?? '');
      setIsDefault(template.is_default);
      setAccent(cfg.branding.accent_color ?? '#1d4ed8');
      setAccentSecondary(cfg.branding.accent_color_secondary ?? '#0ea5e9');
      setHeaderText(cfg.branding.header_text ?? '');
      setFooterText(cfg.branding.footer_text ?? '');
      setLogoKey(cfg.branding.logo_storage_key ?? null);
      setLogoPreview(null);
      setCoverKey(cfg.branding.cover_pdf_storage_key ?? null);
      setCoverName(cfg.branding.cover_pdf_storage_key ? cfg.branding.cover_pdf_storage_key.split('/').pop() ?? null : null);
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
      setHighestVisited(STEPS.length - 1);
    } else {
      setName('');
      setDescription('');
      setIsDefault(false);
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
      setHighestVisited(0);
    }
    setError(null);
    setCurrentStep(0);
    createMutation.reset();
    updateMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template, schemaQuery.data]);

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
    setSections((prev) => [...prev, { kind: 'text', id: makeTextId(), title: '', body: '' }]);
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
    } catch (err) {
      setError(err instanceof ApiError ? t('builder.uploadFailed') : t('builder.uploadFailed'));
    } finally {
      setUploading(null);
    }
  };

  function friendlyError(code: string | undefined): string {
    if (code !== undefined && KNOWN_ERROR_CODE.test(code)) {
      const key = code.split(':')[0] ?? code;
      return t.has(`errors.${key}`) ? t(`errors.${key}`) : t('builder.checkFields');
    }
    return t('builder.checkFields');
  }

  const buildConfig = useCallback(() => {
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

  const handleSubmit = useCallback((): void => {
    setError(null);
    if (name.trim() === '') {
      setError(t('errors.NAME_REQUIRED'));
      return;
    }
    const config = buildConfig();
    const trimmedDesc = description.trim();
    const onError = (err: Error): void => {
      setError(err instanceof ApiError ? friendlyError(err.detail ?? undefined) : t('builder.checkFields'));
    };
    if (isEditing && template !== null) {
      updateMutation.mutate(
        { id: template.id, input: { name: name.trim(), description: trimmedDesc === '' ? null : trimmedDesc, config } },
        {
          onSuccess: () => { toast.success(t('builder.updateSuccess')); onOpenChange(false); },
          onError,
        },
      );
      return;
    }
    createMutation.mutate(
      {
        template_type: reportType,
        name: name.trim(),
        description: trimmedDesc === '' ? null : trimmedDesc,
        is_default: isDefault,
        config,
      },
      {
        onSuccess: () => { toast.success(t('builder.createSuccess')); onOpenChange(false); },
        onError,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildConfig, description, isDefault, isEditing, name, onOpenChange, reportType, t, template]);

  const wizardSteps = STEPS.map((step) => ({
    ...step,
    title: t(`builder.steps.${step.id}.title`),
    description: t(`builder.steps.${step.id}.description`),
  }));
  const activeStepId = STEPS[currentStep]?.id ?? 'setup';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[calc(100vh-48px)]" style={{ height: 600 }}>
        <DialogHeader>
          <DialogTitle>{isEditing ? t('builder.editTitle') : t('builder.createTitle')}</DialogTitle>
          <DialogDescription>{t(`reportTypes.${reportType}`)}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
          <Wizard
            steps={wizardSteps}
            currentStep={currentStep}
            highestVisited={highestVisited}
            onStepChange={(next) => { if (next <= highestVisited) setCurrentStep(next); }}
            onNext={() => {
              if (name.trim() === '') return;
              const next = Math.min(STEPS.length - 1, currentStep + 1);
              setCurrentStep(next);
              setHighestVisited((p) => Math.max(p, next));
            }}
            onBack={() => { setCurrentStep((p) => Math.max(0, p - 1)); }}
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
                <p className="font-sans text-body3 text-error" role="alert">
                  {error}
                </p>
              ) : null
            }
          >
            {activeStepId === 'setup' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rt-name">{t('builder.nameLabel')}</Label>
                  <Input
                    id="rt-name"
                    autoFocus
                    placeholder={t('builder.namePlaceholder')}
                    value={name}
                    onChange={(e) => { setName(e.target.value); }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rt-desc">{t('builder.descriptionLabel')}</Label>
                  <Textarea
                    id="rt-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => { setDescription(e.target.value); }}
                  />
                </div>
                {!isEditing && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-low px-3 py-2">
                    <label htmlFor="rt-default" className="flex flex-col">
                      <span className="font-sans text-body3 font-medium text-foreground">{t('builder.defaultLabel')}</span>
                      <span className="font-sans text-caption text-foreground-tertiary">{t('builder.defaultHint')}</span>
                    </label>
                    <Switch id="rt-default" checked={isDefault} onChange={(e) => { setIsDefault(e.target.checked); }} />
                  </div>
                )}
              </div>
            )}

            {activeStepId === 'branding' && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rt-accent">{t('builder.accentLabel')}</Label>
                    <input
                      id="rt-accent"
                      type="color"
                      value={accent}
                      onChange={(e) => { setAccent(e.target.value); }}
                      className="h-9 w-full cursor-pointer rounded-md border border-border bg-background"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rt-accent2">{t('builder.accentSecondaryLabel')}</Label>
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
                  <Label htmlFor="rt-header">{t('builder.headerLabel')}</Label>
                  <Input id="rt-header" value={headerText} onChange={(e) => { setHeaderText(e.target.value); }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rt-footer">{t('builder.footerLabel')}</Label>
                  <Input id="rt-footer" value={footerText} onChange={(e) => { setFooterText(e.target.value); }} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('builder.logoLabel')}</Label>
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
                      {logoKey !== null ? t('builder.replace') : t('builder.upload')}
                    </Button>
                    {logoPreview !== null ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreview} alt="" className="mt-1 h-10 w-auto self-start rounded border border-border" />
                    ) : logoKey !== null ? (
                      <Badge variant="success" size="md">{t('builder.uploaded')}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('builder.coverLabel')}</Label>
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
                      {coverKey !== null ? t('builder.replace') : t('builder.upload')}
                    </Button>
                    {coverName !== null ? (
                      <span className="truncate font-sans text-caption text-foreground-tertiary">{coverName}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {activeStepId === 'content' && (
              <div className="flex flex-col gap-2">
                <span className="font-sans text-caption text-foreground-tertiary">{t('builder.contentHint')}</span>
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
                              placeholder={t('builder.titleOverridePlaceholder')}
                              value={s.titleOverride}
                              onChange={(e) => { patchSection(index, { titleOverride: e.target.value }); }}
                            />
                          </>
                        ) : (
                          <>
                            <Badge variant="info" size="md">{t('builder.textBlock')}</Badge>
                            <Input
                              className="ml-1 flex-1"
                              placeholder={t('builder.textTitlePlaceholder')}
                              value={s.title}
                              onChange={(e) => { patchSection(index, { title: e.target.value }); }}
                            />
                          </>
                        )}
                        <div className="flex shrink-0 items-center">
                          <IconButton size="sm" aria-label={t('builder.moveUp')} disabled={index === 0} onClick={() => { moveSection(index, -1); }}>
                            <ChevronUp className="h-4 w-4" />
                          </IconButton>
                          <IconButton size="sm" aria-label={t('builder.moveDown')} disabled={index === sections.length - 1} onClick={() => { moveSection(index, 1); }}>
                            <ChevronDown className="h-4 w-4" />
                          </IconButton>
                          {s.kind === 'text' ? (
                            <IconButton size="sm" aria-label={t('builder.remove')} className="hover:text-error" onClick={() => { removeSection(index); }}>
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          ) : null}
                        </div>
                      </div>
                      {s.kind === 'text' ? (
                        <div className="flex flex-col gap-1.5">
                          <Textarea
                            rows={3}
                            placeholder={t('builder.textBodyPlaceholder')}
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
                  {t('builder.addTextBlock')}
                </button>
              </div>
            )}
          </Wizard>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
