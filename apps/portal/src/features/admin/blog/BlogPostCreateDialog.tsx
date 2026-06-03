'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
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
} from '@bimstitch/ui';

import { Wizard } from '@/components/shared/wizard/Wizard';

import {
  THUMBNAIL_ACCEPT,
  compressImage,
} from '@/lib/images/compressImage';

import { BlogFormSchema, type BlogFormValues } from './blogFormSchema';
import {
  BLOG_WIZARD_STEPS,
  BLOG_WIZARD_STEP_FIELDS,
  type BlogWizardStepId,
} from './blogWizardSteps';
import { slugify } from './frontmatter';
import { useCreateBlogPost } from './useCreateBlogPost';
import { BlogStepDutch } from './wizard/BlogStepDutch';
import { BlogStepEnglish } from './wizard/BlogStepEnglish';
import { BlogStepMeta } from './wizard/BlogStepMeta';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const LAST_STEP = BLOG_WIZARD_STEPS.length - 1;

// Today as YYYY-MM-DD — same trick ProjectFormDialog uses for delivery-date
// defaults. Captured at module init via the Date constructor.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaults(): BlogFormValues {
  return {
    description: '',
    date: todayIso(),
    status: 'published',
    author: 'BimDossier',
    tags: '',
    title_en: '',
    content_en: '',
    title_nl: '',
    content_nl: '',
  };
}

export function BlogPostCreateDialog({ open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('admin.blog.create');
  const tCommon = useTranslations('admin.common');
  const mutation = useCreateBlogPost();

  const [currentStep, setCurrentStep] = useState(0);
  const [highestVisited, setHighestVisited] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Single shared cover image + preview + error — parent-state, same
  // pattern ProjectFormDialog uses for `thumbnailFile`.
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  // Ref that always tracks the latest coverFile. `onSubmitImpl` is passed to
  // `form.handleSubmit` inside a `useCallback([form])` closure — form is
  // stable so the closure never re-creates, meaning it would capture the
  // initial null coverFile forever. Reading from coverFileRef bypasses the
  // stale-closure problem without adding coverFile to handleSubmit's deps
  // (which would cause the Radix infinite-loop we already fixed elsewhere).
  const coverFileRef = useRef<File | null>(null);

  const form = useForm<BlogFormValues>({
    resolver: zodResolver(BlogFormSchema),
    defaultValues: buildDefaults(),
    mode: 'onSubmit',
  });

  // CRITICAL: destructure setValue / reset / trigger out of `form` and depend
  // on the destructured locals — NOT on `form` itself. The previous 2-step
  // dialog had an infinite-loop bug (Radix dialog usePresence + form
  // re-render cycle) until this fix was applied. Replicate it; do not
  // regress.
  const { reset: resetForm } = form;
  const { reset: resetMutation } = mutation;

  // Reset everything whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    resetForm(buildDefaults());
    resetMutation();
    setCoverFile(null);
    coverFileRef.current = null;
    setCoverPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
    setCoverError(null);
    setCurrentStep(0);
    setHighestVisited(0);
  }, [open, resetForm, resetMutation]);

  // On step change, focus the first input — mirrors ProjectFormDialog.
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

  const handleCoverChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const fileList = input.files;
    const file = fileList === null ? undefined : fileList[0];
    input.value = '';
    // eslint-disable-next-line no-console
    console.log('[blog-cover] handleCoverChange fired ' + JSON.stringify({
      fileListLength: fileList === null ? null : fileList.length,
      fileName: file?.name,
      fileType: file?.type,
      fileSize: file?.size,
    }));
    if (file === undefined) {
      // eslint-disable-next-line no-console
      console.warn('[blog-cover] no file in the input — aborting (file === undefined)');
      return;
    }
    // Accept image/jpg as a synonym for image/jpeg — some Android/older Safari
    // builds report the non-standard short form.
    const normalizedType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
    const acceptedTypes = THUMBNAIL_ACCEPT.split(',');
    // eslint-disable-next-line no-console
    console.log('[blog-cover] type check ' + JSON.stringify({
      rawType: file.type,
      normalizedType,
      acceptedTypes,
      accepted: acceptedTypes.includes(normalizedType),
    }));
    if (!acceptedTypes.includes(normalizedType)) {
      // eslint-disable-next-line no-console
      console.warn('[blog-cover] REJECTED on type — setting coverType error', {
        rawType: file.type,
        normalizedType,
      });
      setCoverError(t('errors.coverType'));
      return;
    }
    // Drop the hard size cap on the input. `compressImage` rescales to 800px
    // max and re-encodes to JPEG 0.82 — output is typically <300 KB regardless
    // of input. Capping at 2 MB here was inherited from the project-thumbnail
    // flow but rejects perfectly-valid blog-cover photography from phones /
    // mirrorless. The API still enforces a 5 MB ceiling on the (compressed)
    // upload itself.
    setCoverError(null);
    // Set the file + preview SYNCHRONOUSLY so the user can advance to step 2
    // immediately without racing the compression. The compressed version
    // replaces both atomically when it's ready.
    const originalPreview = URL.createObjectURL(file);
    setCoverPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return originalPreview;
    });
    setCoverFile(file);
    coverFileRef.current = file;
    // eslint-disable-next-line no-console
    console.log('[blog-cover] setCoverFile(original) called — cover should now be non-null ' + JSON.stringify({
      fileName: file.name,
    }));
    compressImage(file)
      .then((compressed) => {
        const preview = URL.createObjectURL(compressed);
        setCoverPreviewUrl((prev) => {
          if (prev !== null) URL.revokeObjectURL(prev);
          return preview;
        });
        setCoverFile(compressed);
        coverFileRef.current = compressed;
        // eslint-disable-next-line no-console
        console.log('[blog-cover] compression OK — replaced with compressed file', {
          originalSize: file.size,
          compressedSize: compressed.size,
          compressedType: compressed.type,
        });
      })
      .catch((err: unknown) => {
        // Compression failed — keep the original file so the user can still
        // publish. Flag the error so they know the upload is bigger than
        // expected.
        // eslint-disable-next-line no-console
        console.error('[blog-cover] compression FAILED — keeping original file', err);
        setCoverError(t('errors.coverProcess'));
      });
  };

  const handleClearCover = (): void => {
    setCoverPreviewUrl((prev) => {
      if (prev !== null) URL.revokeObjectURL(prev);
      return null;
    });
    setCoverFile(null);
    coverFileRef.current = null;
  };

  const onSubmitImpl: SubmitHandler<BlogFormValues> = (values) => {
    // Read from the ref so this closure always sees the LATEST cover file,
    // even though handleSubmit is memoised with [form] and never re-creates.
    const currentCover = coverFileRef.current;
    // eslint-disable-next-line no-console
    console.log('[blog-cover] onSubmitImpl (Publish) reached ' + JSON.stringify({
      coverFileIsNull: currentCover === null,
      coverFileName: currentCover?.name,
    }));
    if (currentCover === null) {
      // eslint-disable-next-line no-console
      console.warn('[blog-cover] onSubmitImpl GATE: coverFile is null at Publish — jumping to step 0 with coverRequired error');
      setCoverError(t('errors.coverRequired'));
      setCurrentStep(0);
      return;
    }
    // YYYY-MM-DD → midnight UTC ISO — matches what the 2-step dialog sent.
    const publishedAt = new Date(`${values.date}T00:00:00Z`).toISOString();
    const tagList = Array.from(new Set(
      (values.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ));
    const trimmedAuthor = (values.author ?? '').trim() || 'BimDossier';
    const slug = slugify(values.title_en);

    mutation.mutate(
      {
        slug,
        author: trimmedAuthor,
        tags: tagList,
        published_at: publishedAt,
        status: values.status,
        description: values.description.trim(),
        cover: currentCover,
        en: {
          title: values.title_en.trim(),
          content: values.content_en,
        },
        nl: {
          title: values.title_nl.trim(),
          content: values.content_nl,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('toast.bothCreated'));
          onOpenChange(false);
        },
        onError: (error) => {
          const { code } = error as Error & { code: string | undefined };
          if (code === 'BLOG_SLUG_TAKEN') {
            form.setError('title_en', { type: 'server', message: t('errors.slugTaken') });
            setCurrentStep(1); // english
          } else if (typeof code === 'string' && code.length > 0) {
            toast.error(t('errors.serverCode', { code }));
          } else {
            toast.error(t('errors.serverGeneric'));
          }
        },
      },
    );
  };

  const handleNext = useCallback(async (): Promise<void> => {
    const stepDef = BLOG_WIZARD_STEPS[currentStep];
    if (stepDef === undefined) return;
    // eslint-disable-next-line no-console
    console.log('[blog-cover] handleNext ' + JSON.stringify({
      currentStep,
      stepId: stepDef.id,
      coverFileIsNull: coverFile === null,
      coverFileName: coverFile?.name,
    }));
    // Cover is required to leave the meta step.
    if (stepDef.id === 'meta' && coverFile === null) {
      // eslint-disable-next-line no-console
      console.warn('[blog-cover] handleNext GATE: coverFile is null on meta step — blocking + coverRequired error');
      setCoverError(t('errors.coverRequired'));
      return;
    }
    const fields = BLOG_WIZARD_STEP_FIELDS[stepDef.id];
    const valid = await form.trigger([...fields], { shouldFocus: true });
    // eslint-disable-next-line no-console
    console.log('[blog-cover] handleNext form.trigger result ' + JSON.stringify({
      stepId: stepDef.id,
      fields,
      valid,
      errors: Object.keys(form.formState.errors),
    }));
    if (!valid) return;
    const next = Math.min(LAST_STEP, currentStep + 1);
    setCurrentStep(next);
    setHighestVisited((prev) => Math.max(prev, next));
  }, [currentStep, coverFile, form, t]);

  const handleBack = useCallback((): void => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStepChange = useCallback((next: number): void => {
    if (next > highestVisited) return;
    if (next === currentStep) return;
    setCurrentStep(next);
  }, [highestVisited, currentStep]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    await form.handleSubmit(onSubmitImpl)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const wizardSteps = BLOG_WIZARD_STEPS.map((step) => ({
    ...step,
    title: t(`steps.${step.id}.title`),
    description: t(`steps.${step.id}.description`),
  }));

  const submitLabel = t('actions.publish');
  const submitPendingLabel = t('actions.publishing');
  const isSubmitting = mutation.isPending;

  const activeStepDef = BLOG_WIZARD_STEPS[currentStep];
  const activeStepId: BlogWizardStepId = activeStepDef === undefined
    ? 'meta'
    : activeStepDef.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <FormProvider {...form}>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{tCommon('eyebrowSuperAdmin')} — {t('subtitle')}</DialogDescription>
          </DialogHeader>

          <DialogBody className="min-h-[460px]">
            <Wizard
              steps={wizardSteps}
              currentStep={currentStep}
              highestVisited={highestVisited}
              onStepChange={handleStepChange}
              onNext={handleNext}
              onBack={handleBack}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              submitLabel={submitLabel}
              submitPendingLabel={submitPendingLabel}
              nextLabel={t('actions.next')}
              backLabel={t('actions.back')}
              cancelSlot={(
                <DialogClose asChild>
                  <Button type="button" variant="border" size="md" disabled={isSubmitting}>
                    {t('actions.cancel')}
                  </Button>
                </DialogClose>
              )}
              errorSlot={null}
            >
              <div ref={panelRef} className="flex flex-col gap-4">
                {activeStepId === 'meta' && (
                  <BlogStepMeta
                    coverFile={coverFile}
                    coverPreviewUrl={coverPreviewUrl}
                    coverError={coverError}
                    onCoverFileChange={handleCoverChange}
                    onClearCover={handleClearCover}
                    isSubmitting={isSubmitting}
                    firstFieldRef={firstFieldRef}
                  />
                )}
                {activeStepId === 'english' && (
                  <BlogStepEnglish
                    isSubmitting={isSubmitting}
                    firstFieldRef={firstFieldRef}
                  />
                )}
                {activeStepId === 'dutch' && (
                  <BlogStepDutch
                    isSubmitting={isSubmitting}
                    firstFieldRef={firstFieldRef}
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
