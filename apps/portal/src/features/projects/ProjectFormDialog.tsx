'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useRef, useState,
  type ChangeEvent, type JSX,
} from 'react';
import { FormProvider, useForm, type SubmitHandler } from 'react-hook-form';
import { toast } from 'sonner';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@bimdossier/ui';

import { Wizard } from '@/components/shared/wizard/Wizard';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { ApiError } from '@/lib/api/client';
import type { Project, ProjectRole } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { formatAddress, isProjectArchived } from '@/lib/formatting/projects';
import {
  THUMBNAIL_ACCEPT,
  THUMBNAIL_MAX_BYTES,
  compressImage,
} from '@/lib/images/compressImage';
import {
  ProjectFormSchema,
  type ProjectFormValues,
} from './projectFormSchema';
import {
  useCreateProject,
  type PendingProjectInvite,
  type PendingProjectMember,
} from './useCreateProject';
import { useUpdateProject } from './useUpdateProject';
import {
  PROJECT_CREATE_WIZARD_STEPS,
  PROJECT_WIZARD_STEP_FIELDS,
  PROJECT_WIZARD_STEPS,
} from './wizard/projectWizardSteps';
import { StepAddress } from './wizard/StepAddress';
import { StepBasics } from './wizard/StepBasics';
import { StepDetails } from './wizard/StepDetails';
import { StepMembers, type PendingTeamEntry } from './wizard/StepMembers';

type Props =
  | { mode: 'create'; open: boolean; onOpenChange: (open: boolean) => void }
  | { mode: 'edit'; project: Project; open: boolean; onOpenChange: (open: boolean) => void };

const EMPTY_DEFAULTS: ProjectFormValues = {
  name: '',
  description: '',
  reference_code: '',
  phase: 'design',
  delivery_date: '',
  planned_start_date: '',
  building_type: undefined,
  street: '',
  house_number: '',
  postal_code: '',
  city: '',
  municipality: '',
  permit_number: '',
  bag_id: '',
  latitude: undefined,
  longitude: undefined,
};

function projectToValues(project: Project): ProjectFormValues {
  return {
    name: project.name,
    description: project.description ?? '',
    reference_code: project.reference_code ?? '',
    phase: project.phase,
    delivery_date: project.delivery_date ?? '',
    planned_start_date: project.planned_start_date ?? '',
    building_type: project.building_type ?? undefined,
    street: project.street ?? '',
    house_number: project.house_number ?? '',
    postal_code: project.postal_code ?? '',
    city: project.city ?? '',
    municipality: project.municipality ?? '',
    permit_number: project.permit_number ?? '',
    bag_id: project.bag_id ?? '',
    latitude: project.latitude ?? undefined,
    longitude: project.longitude ?? undefined,
  };
}

function nullableTrim(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function ProjectFormDialog(props: Props): JSX.Element {
  const tWizard = useTranslations('projects.wizard');
  const { mode, open, onOpenChange } = props;
  const project = mode === 'edit' ? props.project : null;
  const isReadOnly = project !== null && isProjectArchived(project);
  const router = useRouter();
  const { me, activeMembership } = useAuth();
  const { isPooled } = useIsPooledContext();

  // The Team step is create-only (existing projects manage members on the access
  // page). Both paid and free creates get it — free invites up to 3 members by
  // email (StepMembers pooledMode). It stays OPTIONAL for free (see submitDisabled).
  const steps =
    mode === 'create' ? PROJECT_CREATE_WIZARD_STEPS : PROJECT_WIZARD_STEPS;
  const LAST_STEP = steps.length - 1;

  const organizationId = activeMembership?.organization_id ?? null;
  const currentUserId = me?.user.id ?? null;

  const [currentStep, setCurrentStep] = useState(0);
  const [highestVisited, setHighestVisited] = useState(
    mode === 'edit' ? LAST_STEP : 0,
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  // Tracks the previous `open` value so the reset effect fires only on the
  // closed -> open transition (see the reset effect below).
  const wasOpenRef = useRef(false);

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const mutation = mode === 'create' ? createMutation : updateMutation;

  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [thumbnailRemoved, setThumbnailRemoved] = useState(false);

  // Team members queued in the create-only "Team" step. Lifted here (like the
  // thumbnail) so it survives navigating between wizard steps, and added after
  // the project exists in `onSubmitImpl`.
  const [pendingTeam, setPendingTeam] = useState<PendingTeamEntry[]>([]);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(ProjectFormSchema),
    defaultValues: project === null ? EMPTY_DEFAULTS : projectToValues(project),
    mode: 'onSubmit',
  });

  const { reset: resetForm } = form;
  const { reset: resetCreateMutation } = createMutation;
  const { reset: resetUpdateMutation } = updateMutation;

  // Reset everything only on the dialog's closed -> open transition. Keying this
  // off `project` identity (instead of the open edge) re-fires mid-session: a
  // successful save invalidates the projects query, the awaited refetch hands us
  // a fresh `project` reference while the dialog is still open, and the reset
  // would snap the wizard back to step 0 AND call resetUpdateMutation() —
  // cancelling the pending onOpenChange(false) so the dialog never closes.
  // Rising-edge gating also stops a background refetch from wiping a half-filled
  // form. `project`/`mode` stay in deps so reopening re-seeds from the latest
  // values; `justOpened` makes the body a no-op on those non-edge re-runs.
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    resetForm(project === null ? EMPTY_DEFAULTS : projectToValues(project));
    resetCreateMutation();
    resetUpdateMutation();
    setThumbnailFile(null);
    setThumbnailPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
    setThumbnailError(null);
    setThumbnailRemoved(false);
    setPendingTeam([]);
    setCurrentStep(0);
    setHighestVisited(mode === 'edit' ? LAST_STEP : 0);
  }, [open, project, mode, LAST_STEP, resetForm, resetCreateMutation, resetUpdateMutation]);

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
      setThumbnailError(tWizard('errors.thumbnailType'));
      return;
    }
    if (file.size > THUMBNAIL_MAX_BYTES) {
      setThumbnailError(tWizard('errors.thumbnailSize'));
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
        setThumbnailError(tWizard('errors.thumbnailProcess'));
      });
  };

  const handleClearThumbnail = (): void => {
    setThumbnailPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
    setThumbnailFile(null);
  };

  const handleRemoveCurrentThumbnail = (): void => {
    setThumbnailRemoved(true);
  };

  const handleAddTeam = useCallback((entry: PendingTeamEntry): void => {
    setPendingTeam((prev) => [...prev, entry]);
  }, []);

  const handleRemoveTeam = useCallback((index: number): void => {
    setPendingTeam((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleChangeTeamRole = useCallback((index: number, role: ProjectRole): void => {
    setPendingTeam((prev) => prev.map((e, i) => (i === index ? { ...e, role } : e)));
  }, []);

  const onSubmitImpl: SubmitHandler<ProjectFormValues> = (values) => {
    const description = nullableTrim(values.description);

    const sharedFields = {
      reference_code: nullableTrim(values.reference_code),
      phase: values.phase,
      delivery_date: nullableTrim(values.delivery_date),
      planned_start_date: nullableTrim(values.planned_start_date),
      building_type: values.building_type ?? null,
      street: nullableTrim(values.street),
      house_number: nullableTrim(values.house_number),
      postal_code: nullableTrim(values.postal_code),
      city: nullableTrim(values.city),
      municipality: nullableTrim(values.municipality),
      permit_number: nullableTrim(values.permit_number),
      bag_id: nullableTrim(values.bag_id),
      latitude: values.latitude ?? null,
      longitude: values.longitude ?? null,
    };

    if (mode === 'create') {
      const members: PendingProjectMember[] = [];
      const invites: PendingProjectInvite[] = [];
      for (const entry of pendingTeam) {
        if (entry.kind === 'org') {
          members.push({ user_id: entry.userId, role: entry.role, label: entry.label });
        } else {
          invites.push({ email: entry.email, full_name: entry.fullName, role: entry.role });
        }
      }

      createMutation.mutate(
        {
          name: values.name,
          description,
          ...sharedFields,
          thumbnailFile: thumbnailFile ?? undefined,
          members,
          invites,
        },
        {
          onSuccess: (result) => {
            onOpenChange(false);
            // The project was created; team adds/invites are best-effort, so
            // surface any that failed rather than blocking navigation.
            if (result.failures.length > 0) {
              toast.error(
                tWizard('members.partialFailure', {
                  names: result.failures
                    .map((f) => `${f.label} — ${f.reason}`)
                    .join('; '),
                }),
              );
            }
            router.push(`/projects/${result.project.id}`);
          },
          onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
              form.setError('name', { type: 'server', message: tWizard('errors.nameTaken') });
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
        ...(thumbnailFile !== null
          ? { thumbnailFile }
          : thumbnailRemoved
            ? { thumbnailFile: null }
            : {}),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            form.setError('name', { type: 'server', message: tWizard('errors.nameTaken') });
            setCurrentStep(0);
          }
        },
      },
    );
  };

  const handleNext = useCallback(async (): Promise<void> => {
    const stepDef = steps[currentStep];
    if (stepDef === undefined) return;
    const fields = PROJECT_WIZARD_STEP_FIELDS[stepDef.id];
    const valid = await form.trigger([...fields], { shouldFocus: true });
    if (!valid) return;
    const next = Math.min(LAST_STEP, currentStep + 1);
    setCurrentStep(next);
    setHighestVisited((prev) => Math.max(prev, next));
  }, [currentStep, form, steps, LAST_STEP]);

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
    // onSubmitImpl wires success/error via mutation callbacks. It is recreated
    // every render and closes over thumbnailFile/thumbnailRemoved (separate
    // useState, not RHF fields), so it MUST be a dependency — omitting it pins
    // handleSubmit to the render-0 closure where thumbnailFile is null, which
    // silently drops the cover-image upload on both create and edit.
    await form.handleSubmit(onSubmitImpl)();
  }, [form, isReadOnly, onOpenChange, onSubmitImpl]);

  const wizardSteps = steps.map((step) => ({
    ...step,
    title: tWizard(`steps.${step.id}.title`),
    description: tWizard(`steps.${step.id}.description`),
  }));

  const title = mode === 'create' ? tWizard('dialog.createTitle') : tWizard('dialog.editTitle');
  const description = mode === 'create'
    ? tWizard('dialog.createDescription')
    : isReadOnly
      ? tWizard('dialog.archivedDescription')
      : tWizard('dialog.editDescription');
  const submitLabel = isReadOnly
    ? tWizard('actions.close')
    : mode === 'create'
      ? tWizard('actions.createProject')
      : tWizard('actions.saveChanges');
  const submitPendingLabel = mode === 'create'
    ? tWizard('actions.creating')
    : tWizard('actions.saving');
  const isSubmitting = mutation.isPending;

  const initialAddressLabel = project === null
    ? undefined
    : (formatAddress({
      street: project.street,
      house_number: project.house_number,
      postal_code: project.postal_code,
      city: project.city,
    }) ?? undefined);

  const activeStepDef = steps[currentStep];
  const activeStepId = activeStepDef === undefined ? 'basics' : activeStepDef.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[calc(100vh-48px)]"
        style={{ height: 640 }}
      >
        <FormProvider {...form}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <DialogBody className="min-h-0 flex-1 overflow-y-auto">
            <Wizard
              steps={wizardSteps}
              currentStep={currentStep}
              highestVisited={highestVisited}
              onStepChange={handleStepChange}
              onNext={handleNext}
              onBack={handleBack}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              submitDisabled={mode === 'create' && !isPooled && pendingTeam.length < 1}
              submitLabel={submitLabel}
              submitPendingLabel={submitPendingLabel}
              cancelSlot={(
                <DialogClose asChild>
                  <Button type="button" variant="border" size="md" disabled={isSubmitting}>
                    {tWizard('actions.cancel')}
                  </Button>
                </DialogClose>
              )}
              errorSlot={null}
            >
              <div ref={panelRef} className="flex flex-col gap-4">
                {activeStepId === 'basics' && (
                  <StepBasics
                    thumbnailFile={thumbnailFile}
                    thumbnailPreviewUrl={thumbnailPreviewUrl}
                    thumbnailError={thumbnailError}
                    currentThumbnailUrl={project?.thumbnail_url ?? null}
                    thumbnailRemoved={thumbnailRemoved}
                    onThumbnailFileChange={handleThumbnailChange}
                    onClearThumbnail={handleClearThumbnail}
                    onRemoveCurrentThumbnail={handleRemoveCurrentThumbnail}
                    isSubmitting={isSubmitting}
                    isReadOnly={isReadOnly}
                    firstFieldRef={firstFieldRef}
                  />
                )}
                {activeStepId === 'details' && (
                  <StepDetails isReadOnly={isReadOnly} country={project?.country ?? 'NL'} />
                )}
                {activeStepId === 'address' && (
                  <StepAddress initialLookupLabel={initialAddressLabel} isReadOnly={isReadOnly} />
                )}
                {activeStepId === 'members' && (
                  <StepMembers
                    organizationId={organizationId}
                    currentUserId={currentUserId}
                    entries={pendingTeam}
                    onAdd={handleAddTeam}
                    onRemove={handleRemoveTeam}
                    onChangeRole={handleChangeTeamRole}
                    pooledMode={isPooled}
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
