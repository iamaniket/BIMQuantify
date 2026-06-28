'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { Button, Input, Label, Select, Textarea } from '@bimdossier/ui';

import type { DocumentViewerHandle, ViewerHandle } from '@bimdossier/viewer';

import { Field } from '@/components/shared/forms/Field';
import { renderFieldInput } from '@/features/findingTemplates/fieldTypes';
import { useCreateFinding } from '@/features/findings/useCreateFinding';
import { registerField } from '@/hooks/registerField';
import type { FindingTemplate, LinkedFileTypeValue } from '@/lib/api/schemas';

import { FindingPinButton, type AnchorState } from './FindingPinButton';
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
  documentHandle?: DocumentViewerHandle | null | undefined;
  viewerHandle?: ViewerHandle | null | undefined;
  /** Active model/file to attach when pinning (even in no-selection scope). */
  activeModelId?: string | null | undefined;
  activeFileId?: string | null | undefined;
  /** Resolve the picked element's GlobalId (active model only), else null. */
  resolvePickedGlobalId?: ((item: { modelId: string; localId: number } | null) => string | null) | undefined;
  onCreated: (findingId: string) => void;
  onCancel?: (() => void) | undefined;
};

function anchorStateFromProps(
  linkedFileType: LinkedFileTypeValue | null | undefined,
  linkedPoint: Record<string, number> | null | undefined,
  linkedElementGlobalId: string | null | undefined,
): AnchorState | null {
  if (linkedPoint == null || linkedFileType == null) return null;
  return {
    linked_file_type: linkedFileType,
    anchor_x: linkedPoint['x'],
    anchor_y: linkedPoint['y'],
    anchor_z: linkedPoint['z'],
    anchor_page: linkedPoint['page'],
    linkedElementGlobalId: linkedElementGlobalId ?? null,
  };
}

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
  documentHandle,
  viewerHandle,
  activeModelId,
  activeFileId,
  resolvePickedGlobalId,
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
  const [pinAnchor, setPinAnchor] = useState<AnchorState | null>(
    () => anchorStateFromProps(linkedFileType, linkedPoint, linkedElementGlobalId),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const titleField = registerField(form, 'title');
  const descriptionField = registerField(form, 'description');
  const severityField = registerField(form, 'severity');
  const bblField = registerField(form, 'bbl_article_ref');

  const builtins = template?.builtin_fields ?? {};
  const showSeverity = builtins['severity']?.visible !== false;
  const showBbl = builtins['bbl_article_ref']?.visible !== false;
  const showPhotos = builtins['photos']?.visible !== false;
  const showReferences = builtins['references']?.visible !== false;
  const customFields = template?.fields ?? [];

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    const anchorPoint: Record<string, number> | null = pinAnchor != null
      ? {
          ...(pinAnchor.anchor_x != null ? { x: pinAnchor.anchor_x } : {}),
          ...(pinAnchor.anchor_y != null ? { y: pinAnchor.anchor_y } : {}),
          ...(pinAnchor.anchor_z != null ? { z: pinAnchor.anchor_z } : {}),
          ...(pinAnchor.anchor_page != null ? { page: pinAnchor.anchor_page } : {}),
        }
      : linkedPoint ?? null;
    const result = buildFindingCreatePayload(
      values,
      { photoIds, referenceAttachmentIds, customValues, template },
      {
        linkedModelId: pinAnchor?.linked_document_id ?? linkedModelId,
        linkedFileId: pinAnchor?.linked_file_id ?? linkedFileId,
        linkedElementGlobalId: pinAnchor?.linkedElementGlobalId ?? linkedElementGlobalId,
        linkedPoint: anchorPoint,
        linkedFileType: pinAnchor?.linked_file_type ?? linkedFileType,
      },
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

      <FindingPinButton
        fileType={linkedFileType ?? null}
        currentAnchor={pinAnchor}
        onAnchorChange={setPinAnchor}
        documentHandle={documentHandle}
        viewerHandle={viewerHandle}
        linkModelId={activeModelId}
        linkFileId={activeFileId}
        resolvePickedGlobalId={resolvePickedGlobalId}
      />

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
