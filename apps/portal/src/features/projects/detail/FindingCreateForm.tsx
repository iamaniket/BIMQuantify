'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { Button, Input, Label, Select, Textarea } from '@bimstitch/ui';

import { Field } from '@/components/shared/forms/Field';
import { renderFieldInput } from '@/features/findingTemplates/fieldTypes';
import { useCreateFinding } from '@/features/findings/useCreateFinding';
import { useRegisterField } from '@/hooks/useRegisterField';
import type { FindingTemplate, LinkedFileTypeValue } from '@/lib/api/schemas';

import { FindingPhotos } from './FindingPhotos';
import { ReferenceDocumentPicker } from './ReferenceDocumentPicker';
import { buildFindingCreatePayload } from './findingCreatePayload';

const SEVERITIES = ['low', 'medium', 'high'] as const;

const FormSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(4000),
  severity: z.enum(SEVERITIES),
  bbl_article_ref: z.string().max(50).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  title: '',
  description: '',
  severity: 'medium',
  bbl_article_ref: '',
};

type Props = {
  projectId: string;
  template?: FindingTemplate | null;
  linkedModelId?: string | null;
  linkedFileId?: string | null;
  linkedElementGlobalId?: string | null;
  linkedPoint?: Record<string, number> | null;
  linkedFileType?: LinkedFileTypeValue | null;
  onCreated: (findingId: string) => void;
  onCancel?: () => void;
};

/**
 * Inline finding create form — the dialog-free counterpart to `FindingFormDialog`,
 * rendered at the top of the inspector findings list (mirrors `BcfCreateForm`).
 * Owns its own Create/Cancel buttons and shares `buildFindingCreatePayload` with
 * the dialog so validation + payload shape stay identical.
 */
export function FindingCreateForm({
  projectId,
  template,
  linkedModelId,
  linkedFileId,
  linkedElementGlobalId,
  linkedPoint,
  linkedFileType,
  onCreated,
  onCancel,
}: Props): JSX.Element {
  const t = useTranslations('findings.form');
  const tSeverity = useTranslations('findings.severity');
  const mutation = useCreateFinding(projectId);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [referenceAttachmentIds, setReferenceAttachmentIds] = useState<string[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [extraError, setExtraError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const titleField = useRegisterField(form, 'title');
  const descriptionField = useRegisterField(form, 'description');
  const severityField = useRegisterField(form, 'severity');
  const bblField = useRegisterField(form, 'bbl_article_ref');

  const builtins = template?.builtin_fields ?? {};
  const showSeverity = builtins['severity']?.visible !== false;
  const showBbl = builtins['bbl_article_ref']?.visible !== false;
  const showPhotos = builtins['photos']?.visible !== false;
  const showReferences = builtins['references']?.visible !== false;
  const customFields = template?.fields ?? [];

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    const result = buildFindingCreatePayload(
      values,
      { photoIds, referenceAttachmentIds, customValues, template },
      { linkedModelId, linkedFileId, linkedElementGlobalId, linkedPoint, linkedFileType },
    );
    if (!result.ok) {
      setExtraError(t('requiredError'));
      return;
    }
    setExtraError(null);
    mutation.mutate(result.payload, {
      onSuccess: (finding) => { onCreated(finding.id); },
    });
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <Field form={form} name="title" label={t('fields.title')}>
        {({ id }) => (
          <Input id={id} placeholder={t('placeholders.title')} autoFocus {...titleField} />
        )}
      </Field>
      <Field form={form} name="description" label={t('fields.description')}>
        {({ id }) => (
          <Textarea id={id} rows={3} placeholder={t('placeholders.description')} {...descriptionField} />
        )}
      </Field>
      {showSeverity && (
        <Field form={form} name="severity" label={t('fields.severity')}>
          {({ id }) => (
            <Select id={id} {...severityField}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{tSeverity(s)}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {showBbl && (
        <Field
          form={form}
          name="bbl_article_ref"
          label={t('fields.bblArticleRef')}
          hint={t('hints.bblArticleRef')}
        >
          {({ id }) => (
            <Input id={id} placeholder={t('placeholders.bblArticleRef')} {...bblField} />
          )}
        </Field>
      )}

      {customFields.map((field) => (
        <div key={field.id} className="flex flex-col gap-1.5">
          <Label htmlFor={`cf-${field.id}`}>
            {field.label}
            {field.required ? ' *' : ''}
          </Label>
          {renderFieldInput({
            field,
            value: customValues[field.id],
            onChange: (value) => {
              setCustomValues((prev) => ({ ...prev, [field.id]: value }));
            },
            id: `cf-${field.id}`,
          })}
          {field.help_text != null && field.help_text !== '' && (
            <span className="font-sans text-caption text-foreground-tertiary">
              {field.help_text}
            </span>
          )}
        </div>
      ))}

      {showPhotos && (
        <FindingPhotos
          projectId={projectId}
          photoIds={photoIds}
          onChange={setPhotoIds}
        />
      )}
      {showReferences && (
        <ReferenceDocumentPicker
          projectId={projectId}
          referenceIds={referenceAttachmentIds}
          onChange={setReferenceAttachmentIds}
        />
      )}

      {extraError !== null && (
        <p className="font-sans text-body3 text-error" role="alert">
          {extraError}
        </p>
      )}

      <div className="flex items-center gap-2">
        {onCancel !== undefined && (
          <Button type="button" variant="border" size="md" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="md"
          className="flex-1"
          disabled={mutation.isPending}
        >
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
