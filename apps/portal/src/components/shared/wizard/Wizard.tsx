'use client';

import { Button, cn } from '@bimdossier/ui';
import { Check } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { type JSX, type ReactNode, type KeyboardEvent } from 'react';

export type WizardStep = {
  id: string;
  title: string;
  description?: string;
  optional?: boolean;
};

export type WizardProps = {
  steps: readonly WizardStep[];
  currentStep: number;
  highestVisited: number;
  onStepChange: (next: number) => void;
  onNext: () => void | Promise<void>;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
  isSubmitting?: boolean;
  /** Disables the primary button on the LAST step only (e.g. an unmet
   * minimum). Ignored on intermediate steps, where the button is "Next". */
  submitDisabled?: boolean;
  submitLabel?: string;
  submitPendingLabel?: string;
  nextLabel?: string;
  backLabel?: string;
  cancelSlot?: ReactNode;
  errorSlot?: ReactNode;
  children: ReactNode;
};

export type WizardStepperProps = {
  steps: readonly WizardStep[];
  currentStep: number;
  highestVisited: number;
  onStepClick: (next: number) => void;
  className?: string;
};

const stepperBase =
  'flex w-full flex-wrap items-center gap-2 border-b border-border pb-4';

const stepButtonBase =
  'group flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 '
  + 'focus-visible:ring-offset-background';

const stepButtonInteractive = 'cursor-pointer hover:bg-background-hover';
const stepButtonLocked = 'cursor-not-allowed';

const stepIndicatorBase =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-body3 font-semibold transition-colors';

const stepIndicatorActive =
  'border-primary bg-primary text-primary-foreground';
const stepIndicatorComplete =
  'border-primary bg-primary/10 text-primary';
const stepIndicatorUpcoming =
  'border-border bg-background text-foreground-tertiary';

const stepTitleBase = 'truncate text-body3 font-medium';
const stepTitleActive = 'text-foreground';
const stepTitleComplete = 'text-foreground-secondary';
const stepTitleUpcoming = 'text-foreground-tertiary';

export function WizardStepper({
  steps,
  currentStep,
  highestVisited,
  onStepClick,
  className,
}: WizardStepperProps): JSX.Element {
  const t = useTranslations('common');
  return (
    <ol role="list" className={cn(stepperBase, className)}>
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isComplete = index < currentStep || (index < highestVisited && index !== currentStep);
        const isReachable = index <= highestVisited;
        const isLocked = !isReachable && !isActive;

        const handleClick = (): void => {
          if (isLocked || isActive) return;
          onStepClick(index);
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (isLocked || isActive) return;
          event.preventDefault();
          onStepClick(index);
        };

        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              onClick={handleClick}
              onKeyDown={handleKeyDown}
              disabled={isLocked}
              aria-current={isActive ? 'step' : undefined}
              aria-disabled={isLocked || undefined}
              aria-label={isComplete ? `${step.title} (completed)` : step.title}
              className={cn(
                stepButtonBase,
                isLocked ? stepButtonLocked : stepButtonInteractive,
              )}
            >
              <span
                className={cn(
                  stepIndicatorBase,
                  isActive
                    ? stepIndicatorActive
                    : isComplete
                      ? stepIndicatorComplete
                      : stepIndicatorUpcoming,
                )}
                aria-hidden="true"
              >
                {isComplete ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    stepTitleBase,
                    isActive
                      ? stepTitleActive
                      : isComplete
                        ? stepTitleComplete
                        : stepTitleUpcoming,
                  )}
                >
                  {step.title}
                  {step.optional === true && (
                    <span className="ml-1 font-normal text-foreground-tertiary">
                      {t('optional')}
                    </span>
                  )}
                </span>
                {step.description !== undefined && step.description.length > 0 && (
                  <span className="truncate text-caption text-foreground-tertiary">
                    {step.description}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

WizardStepper.displayName = 'WizardStepper';

export function Wizard({
  steps,
  currentStep,
  highestVisited,
  onStepChange,
  onNext,
  onBack,
  onSubmit,
  isSubmitting = false,
  submitDisabled = false,
  submitLabel = 'Submit',
  submitPendingLabel = 'Submitting…',
  nextLabel = 'Next',
  backLabel = 'Back',
  cancelSlot,
  errorSlot,
  children,
}: WizardProps): JSX.Element {
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  const handlePrimary = (): void => {
    if (isLast) {
      void onSubmit();
      return;
    }
    void onNext();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <WizardStepper
        steps={steps}
        currentStep={currentStep}
        highestVisited={highestVisited}
        onStepClick={onStepChange}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">{children}</div>
      {errorSlot !== undefined && errorSlot !== null && (
        <div className="-mb-2">{errorSlot}</div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          {cancelSlot}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="border"
            size="md"
            onClick={onBack}
            disabled={isFirst || isSubmitting}
          >
            {backLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handlePrimary}
            disabled={isSubmitting || (isLast && submitDisabled)}
          >
            {isLast
              ? (isSubmitting ? submitPendingLabel : submitLabel)
              : nextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

Wizard.displayName = 'Wizard';
