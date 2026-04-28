'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  useEffect, useId, type JSX,
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

  const nameId = useId();
  const descriptionId = useId();

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const mutation = mode === 'create' ? createMutation : updateMutation;

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
  }, [open, project, resetForm, resetCreateMutation, resetUpdateMutation]);

  const onSubmit: SubmitHandler<ProjectFormValues> = (values) => {
    const trimmedDescription = values.description === undefined
      ? ''
      : values.description.trim();
    const description = trimmedDescription.length === 0 ? null : trimmedDescription;

    if (mode === 'create') {
      createMutation.mutate(
        { name: values.name, description },
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
    ? 'Create a project in your organization.'
    : 'Update this project’s details.';
  const submitLabel = mode === 'create' ? 'Create' : 'Save changes';
  const submitPendingLabel = mode === 'create' ? 'Creating…' : 'Saving…';

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
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? submitPendingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
