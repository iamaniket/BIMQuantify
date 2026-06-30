'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import {
  Input,
  Label,
  Select,
  Textarea,
} from '@bimdossier/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { renderFieldInput } from '@/features/findingTemplates/fieldTypes';
import { useCreateFinding } from '@/features/findings/useCreateFinding';
import { registerField } from '@/hooks/registerField';
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When set, the form is rendered from a custom template: built-in fields are
  // shown/hidden per `builtin_fields`, and the template's custom fields are
  // appended. Omit / null = the built-in "standard form" (today's behaviour).
  template?: FindingTemplate | null;
  // When opened from the viewer (#49) the new finding is pre-linked to the
  // selected IFC element so it round-trips to the 3D model. `linkedModelId` is
  // the version-independent identity (finding follows the element across
  // versions); `linkedFileId` records which version it was raised on.
  linkedModelId?: string | null;
  linkedFileId?: string | null;
  linkedElementGlobalId?: string | null;
  // Anchor coordinates (#anchor): when opened from a viewer pick, the new
  // finding is anchored to the picked point. `linkedFileType` keys the point's
  // shape (ifc -> {x,y,z}; pdf/dxf/dwg/image -> 2D); both come together or not.
  linkedPoint?: Record<string, number> | null;
  linkedFileType?: LinkedFileTypeValue | null;
};

export function FindingFormDialog({
  projectId,
  open,
  onOpenChange,
  template,
  linkedModelId,
  linkedFileId,
  linkedElementGlobalId,
  linkedPoint,
  linkedFileType,
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

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  const titleField = registerField(form, 'title');
  const descriptionField = registerField(form, 'description');
  const severityField = registerField(form, 'severity');
  const bblField = registerField(form, 'bbl_article_ref');

  useEffect(() => {
    if (open) {
      resetForm(EMPTY);
      resetMutation();
      setPhotoIds([]);
      setReferenceAttachmentIds([]);
      setCustomValues({});
      setExtraError(null);
    }
  }, [open, resetForm, resetMutation]);

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
      onSuccess: () => { onOpenChange(false); },
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createTitle')}
      description={t('createSubtitle')}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={t('submit')}
      cancelLabel={t('cancel')}
      submitDisabled={mutation.isPending}
      height={600}
    >
      <div className="flex flex-col gap-4">
        <Field form={form} name="title" label={t('fields.title')}>
          {({ id }) => (
            <Input
              id={id}
              placeholder={t('placeholders.title')}
              autoFocus
              {...titleField}
            />
          )}
        </Field>
        <Field form={form} name="description" label={t('fields.description')}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={4}
              placeholder={t('placeholders.description')}
              {...descriptionField}
            />
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
              <Input
                id={id}
                placeholder={t('placeholders.bblArticleRef')}
                {...bblField}
              />
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
      </div>
    </FormDialog>
  );
}
