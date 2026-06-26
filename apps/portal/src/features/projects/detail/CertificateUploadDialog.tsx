'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';

import {
  Input,
  Label,
  Select,
  Textarea,
} from '@bimdossier/ui';

import { FormDialog } from '@/components/shared/FormDialog';
import { Field } from '@/components/shared/forms/Field';
import { FileField } from '@/components/shared/resource';
import { useRegisterField } from '@/hooks/useRegisterField';
import type { CertificateMetadataInput } from '@/lib/api/certificates';
import { anchorFieldsFromPoint, CertificateTypeEnum } from '@/lib/api/schemas';
import type { CertificateTypeValue, LinkedFileTypeValue } from '@/lib/api/schemas';
import { useUploadCertificate } from '@/features/certificates/useUploadCertificate';

type Props = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedElementGlobalId?: string | null;
  // Version-independent identity (cert follows the element across versions);
  // linkedFileId records which version it was uploaded against.
  linkedModelId?: string | null;
  linkedFileId?: string | null;
  // Anchor coordinates (#anchor): when opened from a viewer pick the cert is
  // anchored to the picked point; linkedFileType keys the point's shape.
  linkedPoint?: Record<string, number> | null;
  linkedFileType?: LinkedFileTypeValue | null;
  // Preselects the certificate type (e.g. when opened from a dossier
  // checklist row for a specific required certificate kind).
  initialType?: CertificateTypeValue;
  // When set, this upload supersedes the given certificate — it becomes the next
  // version in that certificate's group rather than a new document (#35).
  supersedesId?: string | null;
};

const CERTIFICATE_TYPES: CertificateTypeValue[] = [
  'product',
  'installation_test',
  'inspection',
  'warranty',
  'other',
];

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx';

const FormSchema = z.object({
  certificate_type: CertificateTypeEnum,
  certificate_number: z.string().max(255),
  issuer: z.string().max(255),
  subject: z.string().max(255),
  valid_from: z.string(),
  valid_until: z.string(),
  description: z.string().max(4000),
});

type FormValues = z.infer<typeof FormSchema>;

function makeDefaults(type: CertificateTypeValue): FormValues {
  return {
    certificate_type: type,
    certificate_number: '',
    issuer: '',
    subject: '',
    valid_from: '',
    valid_until: '',
    description: '',
  };
}

export function CertificateUploadDialog({
  projectId,
  open,
  onOpenChange,
  linkedElementGlobalId,
  linkedModelId,
  linkedFileId,
  linkedPoint,
  linkedFileType,
  initialType = 'product',
  supersedesId = null,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.certificates');
  const uploadMutation = useUploadCertificate(projectId);
  const fileFieldId = useId();
  const [file, setFile] = useState<File | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: makeDefaults(initialType),
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = uploadMutation;

  useEffect(() => {
    if (!open) return;
    resetForm(makeDefaults(initialType));
    resetMutation();
    setFile(null);
  }, [open, initialType, resetForm, resetMutation]);

  const typeField = useRegisterField(form, 'certificate_type');
  const numberField = useRegisterField(form, 'certificate_number');
  const issuerField = useRegisterField(form, 'issuer');
  const subjectField = useRegisterField(form, 'subject');
  const validFromField = useRegisterField(form, 'valid_from');
  const validUntilField = useRegisterField(form, 'valid_until');
  const descriptionField = useRegisterField(form, 'description');

  const validFrom = form.watch('valid_from');
  const validUntil = form.watch('valid_until');
  const validityInvalid = validFrom !== '' && validUntil !== '' && validUntil < validFrom;

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    if (file === null || validityInvalid) return;
    const metadata: CertificateMetadataInput = {
      certificate_type: values.certificate_type,
      certificate_number: values.certificate_number === '' ? null : values.certificate_number,
      issuer: values.issuer === '' ? null : values.issuer,
      subject: values.subject === '' ? null : values.subject,
      valid_from: values.valid_from === '' ? null : values.valid_from,
      valid_until: values.valid_until === '' ? null : values.valid_until,
      description: values.description === '' ? null : values.description,
      linked_element_global_id: linkedElementGlobalId ?? null,
      linked_document_id: linkedModelId ?? null,
      linked_file_id: linkedFileId ?? null,
      ...anchorFieldsFromPoint(linkedFileType, linkedPoint),
      supersedes_id: supersedesId,
    };
    uploadMutation.mutate(
      { file, metadata },
      {
        onSuccess: () => {
          toast.success(t('uploadSuccess', { name: file.name }));
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={supersedesId === null ? t('uploadTitle') : t('newVersionTitle')}
      description={supersedesId === null ? t('uploadDescription') : t('newVersionDescription')}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={t('uploadButton')}
      cancelLabel={t('cancel')}
      submitDisabled={file === null || validityInvalid || uploadMutation.isPending}
      width={460}
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={fileFieldId}>{t('fieldFile')}</Label>
          <FileField id={fileFieldId} accept={ACCEPT} onFile={setFile} />
        </div>

        <Field form={form} name="certificate_type" label={t('fieldType')}>
          {({ id }) => (
            <Select id={id} {...typeField}>
              {CERTIFICATE_TYPES.map((value) => (
                <option key={value} value={value}>{t(`type.${value}`)}</option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field form={form} name="certificate_number" label={t('fieldNumber')}>
            {({ id }) => (
              <Input id={id} placeholder={t('fieldNumberPlaceholder')} {...numberField} />
            )}
          </Field>
          <Field form={form} name="issuer" label={t('fieldIssuer')}>
            {({ id }) => (
              <Input id={id} placeholder={t('fieldIssuerPlaceholder')} {...issuerField} />
            )}
          </Field>
        </div>

        <Field form={form} name="subject" label={t('fieldSubject')}>
          {({ id }) => (
            <Input id={id} placeholder={t('fieldSubjectPlaceholder')} {...subjectField} />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field form={form} name="valid_from" label={t('fieldValidFrom')}>
            {({ id }) => (
              <Input id={id} type="date" {...validFromField} />
            )}
          </Field>
          <Field form={form} name="valid_until" label={t('fieldValidUntil')}>
            {({ id }) => (
              <Input id={id} type="date" invalid={validityInvalid} {...validUntilField} />
            )}
          </Field>
        </div>

        {validityInvalid && (
          <p className="text-caption text-error">{t('validityError')}</p>
        )}

        <Field form={form} name="description" label={t('fieldDescription')}>
          {({ id }) => (
            <Textarea id={id} rows={2} placeholder={t('fieldDescriptionPlaceholder')} {...descriptionField} />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}
