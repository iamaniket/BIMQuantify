'use client';

import { ImagePlus, X } from 'lucide-react';
import {
  useId,
  useRef,
  type ChangeEvent,
  type JSX,
  type RefObject,
} from 'react';
import { useFormContext } from 'react-hook-form';

import {
  Button, Input, Label, Textarea,
} from '@bimstitch/ui';

import type { ProjectFormValues } from '../projectFormSchema';

import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage,
} from './stepStyles';

const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp';

export type StepBasicsProps = {
  /** Whether to show the thumbnail picker (only in create mode). */
  showThumbnail: boolean;
  thumbnailFile: File | null;
  thumbnailPreviewUrl: string | null;
  thumbnailError: string | null;
  onThumbnailFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearThumbnail: () => void;
  isSubmitting: boolean;
  /** Optional ref so the parent can focus the first field on step entry. */
  firstFieldRef: RefObject<HTMLInputElement | null> | undefined;
};

export function StepBasics({
  showThumbnail,
  thumbnailFile,
  thumbnailPreviewUrl,
  thumbnailError,
  onThumbnailFileChange,
  onClearThumbnail,
  isSubmitting,
  firstFieldRef,
}: StepBasicsProps): JSX.Element {
  const form = useFormContext<ProjectFormValues>();
  const nameId = useId();
  const descriptionId = useId();
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const { errors } = form.formState;
  const nameError = getFieldErrorMessage(errors, 'name');
  const descriptionError = getFieldErrorMessage(errors, 'description');

  const nameRegister = form.register('name', {
    onChange: () => {
      const current = errors.name;
      if (current === undefined) return;
      if (current.type === 'server') form.clearErrors('name');
    },
  });

  const handleOpenFilePicker = (): void => {
    const input = thumbnailInputRef.current;
    if (input !== null) input.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId} className={fieldLabelClass}>Name</Label>
        <Input
          id={nameId}
          type="text"
          autoComplete="off"
          invalid={nameError !== undefined}
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
        <Label htmlFor={descriptionId} className={fieldLabelClass}>Description</Label>
        <Textarea
          id={descriptionId}
          rows={3}
          invalid={descriptionError !== undefined}
          {...form.register('description')}
        />
        {descriptionError !== undefined && (
          <span role="alert" className={fieldErrorClass}>{descriptionError}</span>
        )}
      </div>

      {showThumbnail && (
        <div className="flex flex-col gap-2">
          <Label className={fieldLabelClass}>
            Cover image{' '}
            <span className="text-foreground-tertiary font-normal">(optional)</span>
          </Label>
          <input
            ref={thumbnailInputRef}
            type="file"
            accept={THUMBNAIL_ACCEPT}
            className="hidden"
            onChange={onThumbnailFileChange}
          />
          {thumbnailFile !== null && thumbnailPreviewUrl !== null ? (
            <div className="relative overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailPreviewUrl}
                alt="Cover preview"
                className="h-32 w-full object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-2 top-2 h-7 w-7 bg-background/80 p-0 backdrop-blur-sm"
                aria-label="Remove cover image"
                disabled={isSubmitting}
                onClick={onClearThumbnail}
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
              Add cover image
            </Button>
          )}
          {thumbnailError !== null && (
            <span role="alert" className={fieldErrorClass}>{thumbnailError}</span>
          )}
          <p className="text-caption text-foreground-tertiary">
            JPEG, PNG or WebP · max 2 MB · auto-resized to 800 px
          </p>
        </div>
      )}
    </div>
  );
}
