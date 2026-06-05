'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import {
  Input,
  Select,
  Textarea,
} from '@bimstitch/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { useCreateFinding } from '@/features/findings/useCreateFinding';
import { useRegisterField } from '@/hooks/useRegisterField';
import { anchorFieldsFromPoint, type LinkedFileTypeValue } from '@/lib/api/schemas';

import { FindingPhotos } from './FindingPhotos';
import { ReferenceDocumentPicker } from './ReferenceDocumentPicker';

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

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  const titleField = useRegisterField(form, 'title');
  const descriptionField = useRegisterField(form, 'description');
  const severityField = useRegisterField(form, 'severity');
  const bblField = useRegisterField(form, 'bbl_article_ref');

  useEffect(() => {
    if (open) {
      resetForm(EMPTY);
      resetMutation();
      setPhotoIds([]);
      setReferenceAttachmentIds([]);
    }
  }, [open, resetForm, resetMutation]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    mutation.mutate(
      {
        title: values.title.trim(),
        description: values.description.trim(),
        severity: values.severity,
        bbl_article_ref:
          values.bbl_article_ref === undefined || values.bbl_article_ref === ''
            ? null
            : values.bbl_article_ref.trim(),
        linked_model_id: linkedModelId === undefined ? null : linkedModelId,
        linked_file_id: linkedFileId === undefined ? null : linkedFileId,
        linked_element_global_id:
          linkedElementGlobalId === undefined ? null : linkedElementGlobalId,
        ...anchorFieldsFromPoint(linkedFileType, linkedPoint),
        photo_ids: photoIds.length > 0 ? photoIds : undefined,
        reference_attachment_ids: referenceAttachmentIds.length > 0 ? referenceAttachmentIds : undefined,
      },
      {
        onSuccess: () => { onOpenChange(false); },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createTitle')}
      description={t('createSubtitle')}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={t('submit')}
      submitDisabled={mutation.isPending}
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
        <Field form={form} name="severity" label={t('fields.severity')}>
          {({ id }) => (
            <Select id={id} {...severityField}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{tSeverity(s)}</option>
              ))}
            </Select>
          )}
        </Field>
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
        <FindingPhotos
          projectId={projectId}
          photoIds={photoIds}
          onChange={setPhotoIds}
        />
        <ReferenceDocumentPicker
          projectId={projectId}
          referenceIds={referenceAttachmentIds}
          onChange={setReferenceAttachmentIds}
        />
      </div>
    </FormDialog>
  );
}
