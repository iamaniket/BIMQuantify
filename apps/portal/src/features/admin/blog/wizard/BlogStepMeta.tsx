'use client';

import { ImagePlus, X } from 'lucide-react';
import {
  useId,
  useRef,
  type ChangeEvent,
  type JSX,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';

import {
  Button, Input, Label, Select, Textarea,
} from '@bimstitch/ui';

import { useRegisterField } from '@/hooks/useRegisterField';
import { THUMBNAIL_ACCEPT } from '@/lib/images/compressImage';

import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage,
} from '@/features/projects/wizard/stepStyles';

import type { BlogFormValues } from '../blogFormSchema';

export type BlogStepMetaProps = {
  coverFile: File | null;
  coverPreviewUrl: string | null;
  coverError: string | null;
  onCoverFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearCover: () => void;
  isSubmitting: boolean;
  firstFieldRef: RefObject<HTMLInputElement | null> | undefined;
};

export function BlogStepMeta({
  coverFile,
  coverPreviewUrl,
  coverError,
  onCoverFileChange,
  onClearCover,
  isSubmitting,
  firstFieldRef,
}: BlogStepMetaProps): JSX.Element {
  const t = useTranslations('admin.blog.create');
  const form = useFormContext<BlogFormValues>();
  const dateId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const authorId = useId();
  const tagsId = useId();
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const { errors } = form.formState;
  const descriptionError = getFieldErrorMessage(errors, 'description');
  const dateError = getFieldErrorMessage(errors, 'date');
  const authorError = getFieldErrorMessage(errors, 'author');
  const tagsError = getFieldErrorMessage(errors, 'tags');

  const dateRegister = useRegisterField(form, 'date');

  const handleOpenFilePicker = (): void => {
    const input = coverInputRef.current;
    if (input !== null) input.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className={fieldLabelClass}>
          {t('fields.coverImage')}
        </Label>
        <input
          ref={coverInputRef}
          type="file"
          accept={THUMBNAIL_ACCEPT}
          className="hidden"
          onChange={onCoverFileChange}
        />
        {coverFile !== null && coverPreviewUrl !== null ? (
          <div className="relative overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverPreviewUrl}
              alt={t('fields.coverPreviewAlt')}
              className="h-40 w-full object-cover"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-2 h-7 w-7 bg-background/80 p-0 backdrop-blur-sm"
              aria-label={t('actions.removeCoverImage')}
              disabled={isSubmitting}
              onClick={onClearCover}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="border"
            size="sm"
            className="self-start"
            disabled={isSubmitting}
            onClick={handleOpenFilePicker}
          >
            <ImagePlus className="h-4 w-4" />
            {t('actions.addCoverImage')}
          </Button>
        )}
        {coverError !== null && (
          <span role="alert" className={fieldErrorClass}>{coverError}</span>
        )}
        <p className="text-caption text-foreground-tertiary">
          {t('fields.coverHint')}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={descriptionId} className={fieldLabelClass}>
          {t('fields.description')}
        </Label>
        <Textarea
          id={descriptionId}
          rows={3}
          placeholder={t('placeholders.description')}
          invalid={descriptionError !== undefined}
          disabled={isSubmitting}
          {...useRegisterField(form, 'description')}
        />
        {descriptionError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{descriptionError}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={dateId} className={fieldLabelClass}>
            {t('fields.publishDate')}
          </Label>
          <Input
            id={dateId}
            type="date"
            invalid={dateError !== undefined}
            disabled={isSubmitting}
            {...dateRegister}
            ref={(node) => {
              dateRegister.ref(node);
              if (firstFieldRef !== undefined) {
                // eslint-disable-next-line no-param-reassign
                firstFieldRef.current = node;
              }
            }}
          />
          {dateError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{dateError}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={statusId} className={fieldLabelClass}>
            {t('fields.status')}
          </Label>
          <Select
            id={statusId}
            disabled={isSubmitting}
            {...useRegisterField(form, 'status')}
          >
            <option value="published">{t('statuses.published')}</option>
            <option value="draft">{t('statuses.draft')}</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={authorId} className={fieldLabelClass}>
            {t('fields.author')}
          </Label>
          <Input
            id={authorId}
            type="text"
            placeholder="BimDossier"
            invalid={authorError !== undefined}
            disabled={isSubmitting}
            {...useRegisterField(form, 'author')}
          />
          {authorError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{authorError}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={tagsId} className={fieldLabelClass}>
          {t('fields.tags')}
        </Label>
        <Input
          id={tagsId}
          type="text"
          placeholder={t('placeholders.tags')}
          invalid={tagsError !== undefined}
          disabled={isSubmitting}
          {...useRegisterField(form, 'tags')}
        />
        <span className="text-caption text-foreground-tertiary">
          {t('hints.tags')}
        </span>
        {tagsError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{tagsError}</span>
        )}
      </div>
    </div>
  );
}
