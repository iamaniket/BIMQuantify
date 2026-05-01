'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type JSX,
} from 'react';
import { FormProvider, useForm, type SubmitHandler } from 'react-hook-form';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Wizard,
} from '@bimstitch/ui';

import { ApiError } from '@/lib/api/client';
import type { Project } from '@/lib/api/schemas';

import { formatAddress } from './projectFormatting';
import {
  ProjectFormSchema,
  type ProjectFormValues,
} from './projectFormSchema';
import { useContractors } from './useContractors';
import { useCreateContractor } from './useCreateContractor';
import { useCreateProject } from './useCreateProject';
import { useUpdateProject } from './useUpdateProject';
import {
  PROJECT_WIZARD_STEP_FIELDS,
  PROJECT_WIZARD_STEPS,
} from './wizard/projectWizardSteps';
import { StepAddress } from './wizard/StepAddress';
import { StepBasics } from './wizard/StepBasics';
import { StepContractor } from './wizard/StepContractor';
import { StepDetails } from './wizard/StepDetails';
import { isProjectArchived } from './projectFormatting';

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

const EMPTY_DEFAULTS: ProjectFormValues = {
  name: '',
  description: '',
  reference_code: '',
  status: 'planning',
  phase: 'ontwerp',
  delivery_date: '',
  street: '',
  house_number: '',
  postal_code: '',
  city: '',
  municipality: '',
  permit_number: '',
  bag_id: '',
  latitude: undefined,
  longitude: undefined,
  contractor_id: '',
};

function projectToValues(project: Project): ProjectFormValues {
  return {
    name: project.name,
    description: project.description ?? '',
    reference_code: project.reference_code ?? '',
    status: project.status,
    phase: project.phase,
    delivery_date: project.delivery_date ?? '',
    street: project.street ?? '',
    house_number: project.house_number ?? '',
    postal_code: project.postal_code ?? '',
    city: project.city ?? '',
    municipality: project.municipality ?? '',
    permit_number: project.permit_number ?? '',
    bag_id: project.bag_id ?? '',
    latitude: project.latitude ?? undefined,
    longitude: project.longitude ?? undefined,
    contractor_id: project.contractor_id ?? '',
  };
}

function nullableTrim(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function formatApiError(error: unknown, mode: 'create' | 'edit'): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'A project with that name or reference code already exists.';
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

const LAST_STEP = PROJECT_WIZARD_STEPS.length - 1;

export function ProjectFormDialog(props: Props): JSX.Element {
  const { mode, open, onOpenChange } = props;
  const project = mode === 'edit' ? props.project : null;
  const isReadOnly = project !== null && isProjectArchived(project);
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(0);
  const [highestVisited, setHighestVisited] = useState(
    mode === 'edit' ? LAST_STEP : 0,
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const mutation = mode === 'create' ? createMutation : updateMutation;

  const contractorsQuery = useContractors();
  const createContractorMutation = useCreateContractor();
  const [showAddContractor, setShowAddContractor] = useState(false);
  const [newContractorName, setNewContractorName] = useState('');
  const [contractorError, setContractorError] = useState<string | null>(null);

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

  // Reset everything whenever the dialog opens (or the edited project changes).
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
    setShowAddContractor(false);
    setNewContractorName('');
    setContractorError(null);
    setCurrentStep(0);
    setHighestVisited(mode === 'edit' ? LAST_STEP : 0);
  }, [open, project, mode, resetForm, resetCreateMutation, resetUpdateMutation]);

  // When the active step changes, focus its first input — improves keyboard
  // flow and signals which step the user just landed on. RHF's
  // `trigger({ shouldFocus: true })` covers the validation-error case, so this
  // only fires on successful step transitions.
  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    if (root === null) return;
    if (firstFieldRef.current !== null) {
      firstFieldRef.current.focus({ preventScroll: false });
      return;
    }
    const focusable = root.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea',
    );
    if (focusable !== null) focusable.focus({ preventScroll: false });
  }, [currentStep, open]);

  const handleThumbnailChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const fileList = input.files;
    const file = fileList === null ? undefined : fileList[0];
    input.value = '';
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

  const handleClearThumbnail = (): void => {
    setThumbnailPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
    setThumbnailFile(null);
  };

  const handleAddContractor = useCallback((): void => {
    const trimmed = newContractorName.trim();
    if (trimmed.length === 0) {
      setContractorError('Name is required');
      return;
    }
    setContractorError(null);
    createContractorMutation.mutate(
      { name: trimmed },
      {
        onSuccess: (created) => {
          form.setValue('contractor_id', created.id, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: false,
          });
          setShowAddContractor(false);
          setNewContractorName('');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setContractorError('A contractor with that name already exists.');
          } else {
            setContractorError('Could not create contractor.');
          }
        },
      },
    );
  }, [createContractorMutation, form, newContractorName]);

  const onSubmitImpl: SubmitHandler<ProjectFormValues> = (values) => {
    const description = nullableTrim(values.description);

    const sharedFields = {
      reference_code: nullableTrim(values.reference_code),
      status: values.status,
      phase: values.phase,
      delivery_date: nullableTrim(values.delivery_date),
      street: nullableTrim(values.street),
      house_number: nullableTrim(values.house_number),
      postal_code: nullableTrim(values.postal_code),
      city: nullableTrim(values.city),
      municipality: nullableTrim(values.municipality),
      permit_number: nullableTrim(values.permit_number),
      bag_id: nullableTrim(values.bag_id),
      latitude: values.latitude ?? null,
      longitude: values.longitude ?? null,
      contractor_id: nullableTrim(values.contractor_id),
    };

    if (mode === 'create') {
      createMutation.mutate(
        {
          name: values.name,
          description,
          ...sharedFields,
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
              setCurrentStep(0); // surface the error on the field that owns it
            }
          },
        },
      );
      return;
    }

    updateMutation.mutate(
      {
        id: props.project.id,
        input: { name: values.name, description, ...sharedFields },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            form.setError('name', { type: 'server', message: 'This name is taken' });
            setCurrentStep(0);
          }
        },
      },
    );
  };

  const handleNext = useCallback(async (): Promise<void> => {
    const stepDef = PROJECT_WIZARD_STEPS[currentStep];
    if (stepDef === undefined) return;
    const fields = PROJECT_WIZARD_STEP_FIELDS[stepDef.id];
    const valid = await form.trigger([...fields], { shouldFocus: true });
    if (!valid) return;
    const next = Math.min(LAST_STEP, currentStep + 1);
    setCurrentStep(next);
    setHighestVisited((prev) => Math.max(prev, next));
  }, [currentStep, form]);

  const handleBack = useCallback((): void => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStepChange = useCallback((next: number): void => {
    if (next > highestVisited) return;
    if (next === currentStep) return;
    setCurrentStep(next);
  }, [highestVisited, currentStep]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (isReadOnly) {
      onOpenChange(false);
      return;
    }
    await form.handleSubmit(onSubmitImpl)();
    // onSubmitImpl wires success/error via mutation callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isReadOnly, onOpenChange]);

  const apiErrorMessage = formatApiError(mutation.error, mode);

  const title = mode === 'create' ? 'New project' : 'Edit project';
  const description = mode === 'create'
    ? 'Walk through a few quick steps. You can edit any of these later.'
    : isReadOnly
      ? 'This project is archived. You can review the fields, but editing is disabled until it is reactivated.'
      : 'Jump to any step to update the project.';
  const submitLabel = isReadOnly ? 'Close' : mode === 'create' ? 'Create project' : 'Save changes';
  const submitPendingLabel = mode === 'create' ? 'Creating…' : 'Saving…';
  const isSubmitting = mutation.isPending;
  const contractors = contractorsQuery.data ?? [];

  const initialAddressLabel = project === null
    ? undefined
    : (formatAddress({
      street: project.street,
      house_number: project.house_number,
      postal_code: project.postal_code,
      city: project.city,
    }) ?? undefined);

  const activeStepDef = PROJECT_WIZARD_STEPS[currentStep];
  const activeStepId = activeStepDef === undefined ? 'basics' : activeStepDef.id;

  const errorSlot = apiErrorMessage === null ? null : (
    <div
      role="alert"
      className="rounded-md border border-error-light bg-error-lighter px-3 py-2 text-body3 text-error"
    >
      {apiErrorMessage}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <FormProvider {...form}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <DialogBody className="min-h-[460px]">
            <Wizard
              steps={PROJECT_WIZARD_STEPS}
              currentStep={currentStep}
              highestVisited={highestVisited}
              onStepChange={handleStepChange}
              onNext={handleNext}
              onBack={handleBack}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              submitLabel={submitLabel}
              submitPendingLabel={submitPendingLabel}
              cancelSlot={(
                <DialogClose asChild>
                  <Button type="button" variant="border" size="md" disabled={isSubmitting}>
                    Cancel
                  </Button>
                </DialogClose>
              )}
              errorSlot={errorSlot}
            >
              <div ref={panelRef} className="flex flex-col gap-4">
                {activeStepId === 'basics' && (
                  <StepBasics
                    showThumbnail={mode === 'create'}
                    thumbnailFile={thumbnailFile}
                    thumbnailPreviewUrl={thumbnailPreviewUrl}
                    thumbnailError={thumbnailError}
                    onThumbnailFileChange={handleThumbnailChange}
                    onClearThumbnail={handleClearThumbnail}
                    isSubmitting={isSubmitting}
                    isReadOnly={isReadOnly}
                    firstFieldRef={firstFieldRef}
                  />
                )}
                {activeStepId === 'details' && <StepDetails isReadOnly={isReadOnly} />}
                {activeStepId === 'address' && (
                  <StepAddress initialLookupLabel={initialAddressLabel} isReadOnly={isReadOnly} />
                )}
                {activeStepId === 'contractor' && (
                  <StepContractor
                    contractors={contractors}
                    contractorsLoading={contractorsQuery.isLoading}
                    showAddContractor={showAddContractor}
                    newContractorName={newContractorName}
                    contractorError={contractorError}
                    isAddingContractor={createContractorMutation.isPending}
                    isReadOnly={isReadOnly}
                    onShowAddContractor={() => { setShowAddContractor(true); }}
                    onCancelAddContractor={() => {
                      setShowAddContractor(false);
                      setNewContractorName('');
                      setContractorError(null);
                    }}
                    onChangeNewContractorName={setNewContractorName}
                    onSubmitNewContractor={handleAddContractor}
                  />
                )}
              </div>
            </Wizard>
          </DialogBody>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
