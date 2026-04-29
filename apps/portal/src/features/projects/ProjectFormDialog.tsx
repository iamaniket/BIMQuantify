'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, X } from 'lucide-react';
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

import { formatFileSize, formatRejection } from './fileFormatting';
import {
  ProjectFormSchema,
  type ProjectFormValues,
} from './projectFormSchema';
import { useCreateProject } from './useCreateProject';
import { UploadProgressItem, type UploadState } from './UploadProgressItem';
import { useUpdateProject } from './useUpdateProject';
import { useUploadProjectFile } from './useUploadProjectFile';

type Props =
  | { mode: 'create'; open: boolean; onOpenChange: (open: boolean) => void }
  | { mode: 'edit'; project: Project; open: boolean; onOpenChange: (open: boolean) => void };

const EMPTY_DEFAULTS: ProjectFormValues = { name: '', description: '' };

type FileUpload = {
  id: string;
  file: File;
  state: UploadState;
};

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

function nextUploadId(): string {
  return crypto.randomUUID();
}

function isIfcFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.ifc');
}

export function ProjectFormDialog(props: Props): JSX.Element {
  const { mode, open, onOpenChange } = props;
  const project = mode === 'edit' ? props.project : null;
  const router = useRouter();

  const nameId = useId();
  const descriptionId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const uploadMutation = useUploadProjectFile();
  const mutation = mode === 'create' ? createMutation : updateMutation;

  const [pendingFiles, setPendingFiles] = useState<FileUpload[]>([]);
  const [uploadStarted, setUploadStarted] = useState(false);

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
    setPendingFiles([]);
    setUploadStarted(false);
  }, [open, project, resetForm, resetCreateMutation, resetUpdateMutation]);

  const addFiles = (files: FileList | null): void => {
    if (files === null) return;
    const additions: FileUpload[] = Array.from(files).map((file) => ({
      id: nextUploadId(),
      file,
      state: isIfcFile(file)
        ? { kind: 'idle' }
        : { kind: 'rejected', reason: 'FILE_NOT_ISO_10303_21' },
    }));
    setPendingFiles((prev) => [...prev, ...additions]);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    addFiles(event.target.files);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = '';
    }
  };

  const removePending = (id: string): void => {
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  };

  const closeDialog = (): void => {
    onOpenChange(false);
  };

  const uploadFilesAndContinue = (createdProject: Project): void => {
    const uploadable = pendingFiles.filter((p) => p.state.kind === 'idle');
    if (uploadable.length === 0) {
      closeDialog();
      router.push(`/projects/${createdProject.id}`);
      return;
    }

    setUploadStarted(true);
    setPendingFiles((prev) => prev.map((p) => (
      p.state.kind === 'idle' ? { ...p, state: { kind: 'uploading' } } : p
    )));

    let remaining = uploadable.length;
    let anyFailure = false;

    uploadable.forEach((entry) => {
      uploadMutation.mutate(
        { projectId: createdProject.id, file: entry.file },
        {
          onSuccess: (result) => {
            setPendingFiles((prev) => prev.map((p) => {
              if (p.id !== entry.id) return p;
              if (result.status === 'rejected') {
                anyFailure = true;
                return {
                  ...p,
                  state: {
                    kind: 'rejected',
                    reason: result.rejection_reason ?? 'UNKNOWN',
                  },
                };
              }
              return { ...p, state: { kind: 'success' } };
            }));
            remaining -= 1;
            if (remaining === 0 && !anyFailure) {
              closeDialog();
              router.push(`/projects/${createdProject.id}`);
            }
          },
          onError: (error) => {
            anyFailure = true;
            const message = error instanceof ApiError
              ? error.detail
              : 'Upload failed.';
            setPendingFiles((prev) => prev.map((p) => (
              p.id === entry.id ? { ...p, state: { kind: 'error', message } } : p
            )));
            remaining -= 1;
          },
        },
      );
    });
  };

  const onSubmit: SubmitHandler<ProjectFormValues> = (values) => {
    const trimmedDescription = values.description === undefined
      ? ''
      : values.description.trim();
    const description = trimmedDescription.length === 0 ? null : trimmedDescription;

    if (mode === 'create') {
      createMutation.mutate(
        { name: values.name, description },
        {
          onSuccess: (createdProject) => {
            uploadFilesAndContinue(createdProject);
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
    ? 'Create a project in your organization. Optionally attach IFC files now.'
    : 'Update this project’s details.';
  const submitLabel = mode === 'create' ? 'Create' : 'Save changes';
  const submitPendingLabel = mode === 'create' ? 'Creating…' : 'Saving…';
  const isSubmitting = mutation.isPending || (uploadStarted && pendingFiles.some(
    (p) => p.state.kind === 'uploading',
  ));
  const failedUploads = pendingFiles.filter(
    (p) => p.state.kind === 'rejected' || p.state.kind === 'error',
  );
  const cancelLabel = uploadStarted ? 'Continue to project' : 'Cancel';

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
                <Label>IFC files (optional)</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ifc"
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                <Button
                  type="button"
                  variant="border"
                  size="sm"
                  className="self-start"
                  disabled={isSubmitting}
                  onClick={() => {
                    if (fileInputRef.current !== null) {
                      fileInputRef.current.click();
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add IFC files
                </Button>
                {pendingFiles.length === 0 ? null : (
                  <div className="flex flex-col gap-2">
                    {pendingFiles.map((p) => (
                      p.state.kind === 'idle' ? (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 rounded-md border border-border bg-background-secondary px-3 py-2"
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-body2 text-foreground">
                              {p.file.name}
                            </span>
                            <span className="text-caption text-foreground-tertiary">
                              {formatFileSize(p.file.size)}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${p.file.name}`}
                            className="h-7 w-7 p-0"
                            onClick={() => { removePending(p.id); }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <UploadProgressItem
                          key={p.id}
                          filename={p.file.name}
                          sizeBytes={p.file.size}
                          state={p.state}
                          onRemove={
                            p.state.kind === 'uploading'
                              ? undefined
                              : () => { removePending(p.id); }
                          }
                        />
                      )
                    ))}
                  </div>
                )}
                {uploadStarted && failedUploads.length > 0 ? (
                  <p className="text-body3 text-foreground-secondary">
                    {failedUploads.length}
                    {' file'}
                    {failedUploads.length === 1 ? '' : 's'}
                    {' could not be uploaded. '}
                    {(() => {
                      const first = failedUploads[0];
                      if (first === undefined) return null;
                      if (first.state.kind === 'rejected') {
                        return formatRejection(first.state.reason);
                      }
                      return null;
                    })()}
                    {' You can continue to the project and try again.'}
                  </p>
                ) : null}
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
                {cancelLabel}
              </Button>
            </DialogClose>
            {uploadStarted ? null : (
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={isSubmitting}
              >
                {isSubmitting ? submitPendingLabel : submitLabel}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
