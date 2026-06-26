'use client';

import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

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

import { BrandingStep } from './BrandingStep';
import { ContentStep } from './ContentStep';
import { FieldsStep } from './FieldsStep';
import { SetupStep } from './SetupStep';
import { TypeStep } from './TypeStep';
import { useOrgTemplateForm } from './useOrgTemplateForm';

import type { UnifiedTemplateRow } from './useAllTemplates';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: UnifiedTemplateRow | null;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OrgTemplateBuilderDialog({ open, onOpenChange, editTarget }: Props): JSX.Element {
  const t = useTranslations('orgTemplates');

  const form = useOrgTemplateForm({ open, onOpenChange, editTarget });
  const {
    category,
    reportType,
    setReportType,
    handleCategoryChange,
    name,
    setName,
    description,
    setDescription,
    isDefault,
    setIsDefault,
    error,
    builtins,
    setBuiltins,
    fields,
    updateField,
    moveField,
    addField,
    removeField,
    accent,
    setAccent,
    accentSecondary,
    setAccentSecondary,
    headerText,
    setHeaderText,
    footerText,
    setFooterText,
    logoKey,
    logoPreview,
    coverKey,
    coverName,
    uploading,
    sections,
    logoInput,
    coverInput,
    moveSection,
    patchSection,
    addTextBlock,
    removeSection,
    insertMergeField,
    handleUpload,
    sectionLabels,
    mergeFields,
    currentStep,
    highestVisited,
    activeStepId,
    wizardSteps,
    handleNext,
    handleBack,
    handleStepChange,
    handleSubmit,
    isEditing,
    pending,
  } = form;

  // ---- Render ----
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[calc(100vh-48px)]"
        style={{ height: category === 'report' ? 600 : 560 }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('builder.editTitle') : t('builder.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('builder.subtitle')}</DialogDescription>
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
            isSubmitting={pending}
            submitLabel={t('builder.save')}
            submitPendingLabel={t('builder.saving')}
            nextLabel={t('builder.next')}
            backLabel={t('builder.back')}
            cancelSlot={
              <DialogClose asChild>
                <Button type="button" variant="border" size="md" disabled={pending}>
                  {t('builder.cancel')}
                </Button>
              </DialogClose>
            }
            errorSlot={
              error !== null ? (
                <p className="font-sans text-body3 text-error" role="alert">{error}</p>
              ) : null
            }
          >
            {/* ---- Step: Type selection ---- */}
            {activeStepId === 'type' && (
              <TypeStep
                category={category}
                isEditing={isEditing}
                reportType={reportType}
                onCategoryChange={handleCategoryChange}
                onReportTypeChange={setReportType}
              />
            )}

            {/* ---- Step: Setup ---- */}
            {activeStepId === 'setup' && (
              <SetupStep
                category={category}
                isEditing={isEditing}
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                isDefault={isDefault}
                setIsDefault={setIsDefault}
                builtins={builtins}
                setBuiltins={setBuiltins}
              />
            )}

            {/* ---- Step: Custom fields (finding only) ---- */}
            {activeStepId === 'fields' && (
              <FieldsStep
                fields={fields}
                updateField={updateField}
                moveField={moveField}
                addField={addField}
                removeField={removeField}
              />
            )}

            {/* ---- Step: Branding (report only) ---- */}
            {activeStepId === 'branding' && (
              <BrandingStep
                accent={accent}
                setAccent={setAccent}
                accentSecondary={accentSecondary}
                setAccentSecondary={setAccentSecondary}
                headerText={headerText}
                setHeaderText={setHeaderText}
                footerText={footerText}
                setFooterText={setFooterText}
                logoKey={logoKey}
                logoPreview={logoPreview}
                coverKey={coverKey}
                coverName={coverName}
                uploading={uploading}
                logoInput={logoInput}
                coverInput={coverInput}
                onUpload={handleUpload}
              />
            )}

            {/* ---- Step: Content (report only) ---- */}
            {activeStepId === 'content' && (
              <ContentStep
                sections={sections}
                sectionLabels={sectionLabels}
                mergeFields={mergeFields}
                patchSection={patchSection}
                moveSection={moveSection}
                removeSection={removeSection}
                insertMergeField={insertMergeField}
                addTextBlock={addTextBlock}
              />
            )}
          </Wizard>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
