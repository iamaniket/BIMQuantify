'use client';

import { ImagePlus, X } from '@bimdossier/ui/icons';
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
  Button, Input, Label, Textarea,
} from '@bimdossier/ui';

import { useRegisterField } from '@/hooks/useRegisterField';
import type { ProjectFormValues } from '../projectFormSchema';

import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage,
} from './stepStyles';

const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp';

export type StepBasicsProps = {
  thumbnailFile: File | null;
  thumbnailPreviewUrl: string | null;
  thumbnailError: string | null;
  /** Presigned URL of the project's existing thumbnail (edit mode only). */
  currentThumbnailUrl: string | null;
  /** True when the user has requested to remove the current thumbnail. */
  thumbnailRemoved: boolean;
  onThumbnailFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearThumbnail: () => void;
  onRemoveCurrentThumbnail: () => void;
  isSubmitting: boolean;
  isReadOnly: boolean;
  /** Optional ref so the parent can focus the first field on step entry. */
  firstFieldRef: RefObject<HTMLInputElement | null> | undefined;
};

export function StepBasics({
  thumbnailFile,
  thumbnailPreviewUrl,
  thumbnailError,
  currentThumbnailUrl,
  thumbnailRemoved,
  onThumbnailFileChange,
  onClearThumbnail,
  onRemoveCurrentThumbnail,
  isSubmitting,
  isReadOnly,
  firstFieldRef,
}: StepBasicsProps): JSX.Element {
  const t = useTranslations('projects.wizard.basics');
  const form = useFormContext<ProjectFormValues>();
  const nameId = useId();
  const descriptionId = useId();
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const { errors } = form.formState;
  const nameError = getFieldErrorMessage(errors, 'name');
  const descriptionError = getFieldErrorMessage(errors, 'description');

  const nameRegister = useRegisterField(form, 'name');

  const handleOpenFilePicker = (): void => {
    const input = thumbnailInputRef.current;
    if (input !== null) input.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId} className={fieldLabelClass}>{t('fields.name')}</Label>
        <Input
          id={nameId}
          type="text"
          autoComplete="off"
          invalid={nameError !== undefined}
          disabled={isReadOnly}
          {...nameRegister}
          ref={(node) => {
            nameRegister.ref(node);
            if (firstFieldRef !== undefined) {
              // eslint-disable-next-line no-param-reassign
              firstFieldRef.current = node;
            }
          }}
        />
        {nameError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{nameError}</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={descriptionId} className={fieldLabelClass}>{t('fields.description')}</Label>
        <Textarea
          id={descriptionId}
          rows={3}
          invalid={descriptionError !== undefined}
          disabled={isReadOnly}
          {...useRegisterField(form, 'description')}
        />
        {descriptionError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{descriptionError}</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className={fieldLabelClass}>
          {t('fields.coverImage')}{' '}
          <span className="text-foreground-tertiary font-normal">({t('fields.optional')})</span>
        </Label>
        <input
          ref={thumbnailInputRef}
          type="file"
          accept={THUMBNAIL_ACCEPT}
          className="hidden"
          onChange={onThumbnailFileChange}
          disabled={isReadOnly}
        />
        {thumbnailFile !== null && thumbnailPreviewUrl !== null ? (
          // New file selected — show preview with cancel
          <div className="relative overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailPreviewUrl}
              alt={t('fields.coverPreviewAlt')}
              className="h-32 w-full object-cover"
            />
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="absolute right-2 top-2 h-7 w-7 bg-background/80 p-0 backdrop-blur-sm"
              aria-label={t('actions.removeCoverImage')}
              disabled={isSubmitting}
              onClick={onClearThumbnail}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : !thumbnailRemoved && currentThumbnailUrl !== null ? (
          // Existing thumbnail from the saved project — show with change/remove
          <div className="relative overflow-hidden rounded-md border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentThumbnailUrl}
              alt={t('fields.coverPreviewAlt')}
              className="h-32 w-full object-cover"
            />
            <div className="absolute right-2 top-2 flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="h-7 bg-background/80 px-2 backdrop-blur-sm text-caption"
                disabled={isSubmitting || isReadOnly}
                onClick={handleOpenFilePicker}
              >
                {t('actions.changeCoverImage')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="h-7 w-7 bg-background/80 p-0 backdrop-blur-sm"
                aria-label={t('actions.removeCoverImage')}
                disabled={isSubmitting || isReadOnly}
                onClick={onRemoveCurrentThumbnail}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          // No thumbnail — show add button
          <Button
            type="button"
            variant="border"
            size="md"
            className="self-start"
            disabled={isSubmitting || isReadOnly}
            onClick={handleOpenFilePicker}
          >
            <ImagePlus className="h-4 w-4" />
            {t('actions.addCoverImage')}
          </Button>
        )}
        {thumbnailError !== null && (
          <span role="alert" className={fieldErrorClass}>{thumbnailError}</span>
        )}
        <p className="text-caption text-foreground-tertiary">
          {t('fields.coverHint')}
        </p>
      </div>
    </div>
  );
}
