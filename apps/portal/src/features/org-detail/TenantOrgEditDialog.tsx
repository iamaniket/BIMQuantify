'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Trash2 } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { AppDialog, Button, Input, Label } from '@bimdossier/ui';

import { Field } from '@/components/shared/forms/Field';
import { useRegisterField } from '@/hooks/useRegisterField';
import { ApiError } from '@/lib/api/client';

import { useUpdateOrgName } from './useUpdateOrgName';

const IMAGE_ALLOWED_TYPES = 'image/png,image/jpeg,image/webp';
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const FormSchema = z.object({
  name: z.string().min(1).max(255),
});

type FormValues = z.infer<typeof FormSchema>;

type Props = {
  organizationId: string;
  currentName: string;
  imageUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageUpload: (file: File) => void;
  onImageRemove: () => void;
  onSuccess: () => void;
};

function orgInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function TenantOrgEditDialog({
  organizationId,
  currentName,
  imageUrl,
  open,
  onOpenChange,
  onImageUpload,
  onImageRemove,
  onSuccess,
}: Props): JSX.Element {
  const t = useTranslations('tenantAdmin.editOrg');
  const mutation = useUpdateOrgName();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: currentName },
  });

  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;
  useEffect(() => {
    if (open) {
      resetForm({ name: currentName });
      resetMutation();
      setUploading(false);
    }
  }, [open, currentName, resetForm, resetMutation]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > IMAGE_MAX_BYTES) return;
      setUploading(true);
      try {
        await onImageUpload(file);
      } finally {
        setUploading(false);
      }
      e.target.value = '';
    },
    [onImageUpload],
  );

  const handleRemoveImage = useCallback(async () => {
    setUploading(true);
    try {
      await onImageRemove();
    } finally {
      setUploading(false);
    }
  }, [onImageRemove]);

  const onSubmit: SubmitHandler<FormValues> = (values) => {
    mutation.mutate(
      { organizationId, name: values.name.trim() },
      {
        onSuccess: () => {
          onOpenChange(false);
          onSuccess();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            if (error.detail === 'ORG_NAME_TAKEN') {
              form.setError('name', { message: t('errors.nameTaken') });
            }
          }
        },
      },
    );
  };

  const watchedName = form.watch('name');

  return (
    <AppDialog
      open={open}
      onClose={() => { onOpenChange(false); }}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      onSave={form.handleSubmit(onSubmit)}
      saveLabel={t('submit')}
      saveDisabled={mutation.isPending || uploading}
    >
      <div className="flex flex-col gap-5">
        {/* Logo */}
        <div>
          <Label className="mb-1.5 block">
            {t('fields.logo')}
          </Label>
          <div className="flex items-center gap-4">
            <div className="group relative h-[78px] w-[117px] overflow-hidden rounded-lg border border-black/10 bg-black/5 shadow-sm dark:border-white/15 dark:bg-white/10">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={currentName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-primary-light text-xl font-extrabold text-primary-foreground">
                  {orgInitials(watchedName || currentName)}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ALLOWED_TYPES}
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label={imageUrl ? t('changeImage') : t('uploadImage')}
              >
                <Camera className="h-4 w-4 text-white" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button
                variant="border"
                size="md"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Camera className="mr-1 h-3.5 w-3.5" />
                {imageUrl ? t('changeImage') : t('uploadImage')}
              </Button>
              {imageUrl && (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={handleRemoveImage}
                  disabled={uploading}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5 text-error" />
                  <span className="text-error">{t('removeImage')}</span>
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-caption text-foreground-tertiary">
            {t('hints.logo')}
          </p>
        </div>

        {/* Name */}
        <Field form={form} name="name" label={t('fields.name')}>
          {({ id }) => <Input id={id} autoFocus {...useRegisterField(form, 'name')} />}
        </Field>
      </div>
    </AppDialog>
  );
}
