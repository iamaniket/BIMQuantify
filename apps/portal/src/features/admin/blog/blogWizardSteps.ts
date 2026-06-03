import type { WizardStep } from '@/components/shared/wizard/Wizard';

/**
 * Stable identifiers for the 3-step blog-post create wizard.
 *
 * - meta:    cover image + shared metadata (description, date, status, …)
 * - english: EN title + content (+ optional .mdx drop zone)
 * - dutch:   NL title + content (+ optional .nl.mdx drop zone)
 */
export type BlogWizardStepId = 'meta' | 'english' | 'dutch';

/**
 * Form-value names per step. Used to scope `form.trigger([...])` validation
 * when advancing to the next step (mirrors PROJECT_WIZARD_STEP_FIELDS).
 *
 * Kept as a string-literal map so the parent dialog can pass it to
 * `form.trigger()` without re-stating the field names inline.
 */
export type BlogWizardFormFieldName =
  | 'description'
  | 'date'
  | 'status'
  | 'author'
  | 'tags'
  | 'title_en'
  | 'content_en'
  | 'title_nl'
  | 'content_nl';

export const BLOG_WIZARD_STEP_FIELDS: Record<
  BlogWizardStepId,
  readonly BlogWizardFormFieldName[]
> = {
  meta: ['description', 'date', 'status', 'author', 'tags'],
  english: ['title_en', 'content_en'],
  dutch: ['title_nl', 'content_nl'],
} as const;

/**
 * Ordered step list rendered in the wizard stepper. Titles/descriptions are
 * filled in by the translator at render time (matches projectWizardSteps).
 */
export const BLOG_WIZARD_STEPS: readonly (WizardStep & { id: BlogWizardStepId })[] = [
  {
    id: 'meta',
    title: 'Photo & details',
    description: 'Cover image and metadata',
  },
  {
    id: 'english',
    title: 'English version',
    description: 'Title and body',
  },
  {
    id: 'dutch',
    title: 'Dutch version',
    description: 'Title and body',
  },
] as const;

export const BLOG_WIZARD_STEP_IDS: readonly BlogWizardStepId[] = (
  BLOG_WIZARD_STEPS.map((s) => s.id)
);
