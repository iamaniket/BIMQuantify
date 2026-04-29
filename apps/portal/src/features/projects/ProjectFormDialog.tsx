'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useEffect, useId, useRef, useState, type ChangeEvent, type JSX,
} from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import type { Project } from '@/lib/api/schemas';

import {
  ProjectFormSchema,
  type ProjectFormValues,
} from './projectFormSchema';
import { useCreateProject } from './useCreateProject';
import { useUpdateProject } from './useUpdateProject';

const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const THUMBNAIL_MAX_DIM = 800;
const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp';

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > THUMBNAIL_MAX_DIM) {
        height = Math.round((height * THUMBNAIL_MAX_DIM) / width);
        width = THUMBNAIL_MAX_DIM;
      }
      if (height > THUMBNAIL_MAX_DIM) {
        width = Math.round((width * THUMBNAIL_MAX_DIM) / height);
        height = THUMBNAIL_MAX_DIM;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob === null) { reject(new Error('Encode failed')); return; }
          const outName = file.name.replace(/\.[^.]+$/, '.jpg');
          resolve(new File([blob], outName, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('Load failed')); };
    img.src = blobUrl;
  });
}

type Props =
  | { mode: 'create'; open: boolean; onOpenChange: (open: boolean) => void }
  | { mode: 'edit'; project: Project; open: boolean; onOpenChange: (open: boolean) => void };

const EMPTY_DEFAULTS: ProjectFormValues = { name: '', description: '' };

function projectToValues(project: Project): ProjectFormValues {
  return {
    name: project.name,
    description: project.description ?? '',
  };
}

function formatApiError(error: unknown, mode: 'create' | 'edit'): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'A project with that name already exists in your organization.';
    }
    if (error.status === 403) {
      return 'You do not have permission to modify this project.';
    }
    if (error.status === 404) {
      return 'Project not found. It may have been deleted.';
    }
    const verb = mode === 'create' ? 'Create' : 'Save';
    return `${verb} failed: ${error.detail}`;
  }
  return mode === 'create' ? 'Could not create project.' : 'Could not save changes.';
}

export function ProjectFormDialog(props: Props): JSX.Element {
  const { mode, open, onOpenChange } = props;
  const project = mode === 'edit' ? props.project : null;
  const router = useRouter();

  const nameId = useId();
  const descriptionId = useId();
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const mutation = mode === 'create' ? createMutation : updateMutation;

  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(ProjectFormSchema),
    defaultValues: project === null ? EMPTY_DEFAULTS : projectToValues(project),
    mode: 'onSubmit',
  });

  const { reset: resetForm } = form;
  const { reset: resetCreateMutation } = createMutation;
  const { reset: resetUpdateMutation } = updateMutation;

  useEffect(() => {
    if (!open) return;
    resetForm(project === null ? EMPTY_DEFAULTS : projectToValues(project));
    resetCreateMutation();
    resetUpdateMutation();
    setThumbnailFile(null);
    setThumbnailPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
    setThumbnailError(null);
  }, [open, project, resetForm, resetCreateMutation, resetUpdateMutation]);

  const handleThumbnailChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const fileList = event.target.files;
    const file = fileList === null ? undefined : fileList[0];
    if (thumbnailInputRef.current !== null) {
      thumbnailInputRef.current.value = '';
    }
    if (file === undefined) return;
    if (!THUMBNAIL_ACCEPT.split(',').includes(file.type)) {
      setThumbnailError('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > THUMBNAIL_MAX_BYTES) {
      setThumbnailError('Image must be 2 MB or smaller.');
      return;
    }
    setThumbnailError(null);
    compressImage(file)
      .then((compressed) => {
        const preview = URL.createObjectURL(compressed);
        setThumbnailPreviewUrl((prev) => {
          if (prev !== null) URL.revokeObjectURL(prev);
          return preview;
        });
        setThumbnailFile(compressed);
      })
      .catch(() => {
        setThumbnailError('Could not process image. Please try another file.');
      });
  };

  const onSubmit: SubmitHandler<ProjectFormValues> = (values) => {
    const trimmedDescription = values.description === undefined
      ? ''
      : values.description.trim();
    const description = trimmedDescription.length === 0 ? null : trimmedDescription;

    if (mode === 'create') {
      createMutation.mutate(
        {
          name: values.name,
          description,
          thumbnailFile: thumbnailFile ?? undefined,
        },
        {
          onSuccess: (createdProject) => {
            onOpenChange(false);
            router.push(`/projects/${createdProject.id}`);
          },
          onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
              form.setError('name', { type: 'server', message: 'This name is taken' });
            }
          },
        },
      );
      return;
    }

    updateMutation.mutate(
      { id: props.project.id, input: { name: values.name, description } },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            form.setError('name', { type: 'server', message: 'This name is taken' });
          }
        },
      },
    );
  };

  const apiErrorMessage = formatApiError(mutation.error, mode);
  const nameFieldError = form.formState.errors.name;
  const descriptionFieldError = form.formState.errors.description;
  const nameError = nameFieldError === undefined ? undefined : nameFieldError.message;
  const descriptionError = descriptionFieldError === undefined
    ? undefined
    : descriptionFieldError.message;

  const title = mode === 'create' ? 'New project' : 'Edit project';
  const description = mode === 'create'
    ? 'Create a project in your organization. You can add models and IFC files from the project page.'
    : 'Update this project’s details.';
  const submitLabel = mode === 'create' ? 'Create' : 'Save changes';
  const submitPendingLabel = mode === 'create' ? 'Creating…' : 'Saving…';
  const isSubmitting = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                type="text"
                autoComplete="off"
                autoFocus
                invalid={nameError !== undefined}
                {...form.register('name', {
                  onChange: () => {
                    const currentNameError = form.formState.errors.name;
                    if (currentNameError === undefined) return;
                    if (currentNameError.type === 'server') {
                      form.clearErrors('name');
                    }
                  },
                })}
              />
              {nameError === undefined ? null : (
                <span role="alert" className="text-body3 text-error">
                  {nameError}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea
                id={descriptionId}
                rows={4}
                invalid={descriptionError !== undefined}
                {...form.register('description')}
              />
              {descriptionError === undefined ? null : (
                <span role="alert" className="text-body3 text-error">
                  {descriptionError}
                </span>
              )}
            </div>

            {mode === 'create' ? (
              <div className="flex flex-col gap-2">
                <Label>Cover image <span className="text-foreground-tertiary font-normal">(optional)</span></Label>
                <input
                  ref={thumbnailInputRef}
                  type="file"
                  accept={THUMBNAIL_ACCEPT}
                  className="hidden"
                  onChange={handleThumbnailChange}
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
                      onClick={() => {
                        setThumbnailPreviewUrl((prev) => {
                          if (prev !== null) URL.revokeObjectURL(prev);
                          return null;
                        });
                        setThumbnailFile(null);
                      }}
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
                    onClick={() => {
                      if (thumbnailInputRef.current !== null) {
                        thumbnailInputRef.current.click();
                      }
                    }}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Add cover image
                  </Button>
                )}
                {thumbnailError === null ? null : (
                  <span role="alert" className="text-body3 text-error">
                    {thumbnailError}
                  </span>
                )}
                <p className="text-caption text-foreground-tertiary">
                  JPEG, PNG or WebP · max 2 MB · auto-resized to 800 px
                </p>
              </div>
            ) : null}

            {apiErrorMessage === null ? null : (
              <div
                role="alert"
                className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
              >
                {apiErrorMessage}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="border"
                size="md"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={isSubmitting}
            >
              {isSubmitting ? submitPendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
