'use client';

import { useId, type JSX } from 'react';
import { useTranslations } from 'next-intl';
import { useFormContext } from 'react-hook-form';

import { Button, Input, Label, Select } from '@bimstitch/ui';

import type { Contractor } from '@/lib/api/schemas';
import { useRegisterField } from '@/hooks/useRegisterField';

import type { ProjectFormValues } from '../projectFormSchema';

import { fieldErrorClass, fieldLabelClass } from './stepStyles';

export type StepContractorProps = {
  contractors: readonly Contractor[];
  contractorsLoading: boolean;
  /** Inline contractor-create form state (lifted to the dialog so it survives
   * navigation away from this step). */
  showAddContractor: boolean;
  newContractorName: string;
  contractorError: string | null;
  isAddingContractor: boolean;
  isReadOnly: boolean;
  onShowAddContractor: () => void;
  onCancelAddContractor: () => void;
  onChangeNewContractorName: (value: string) => void;
  onSubmitNewContractor: () => void;
};

export function StepContractor({
  contractors,
  contractorsLoading,
  showAddContractor,
  newContractorName,
  contractorError,
  isAddingContractor,
  isReadOnly,
  onShowAddContractor,
  onCancelAddContractor,
  onChangeNewContractorName,
  onSubmitNewContractor,
}: StepContractorProps): JSX.Element {
  const t = useTranslations('projects.wizard.contractor');
  const form = useFormContext<ProjectFormValues>();
  const contractorId = useId();
  const newContractorId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={contractorId} className={fieldLabelClass}>{t('fields.contractor')}</Label>
        <Select
          id={contractorId}
          disabled={contractorsLoading || isReadOnly}
          {...useRegisterField(form, 'contractor_id')}
        >
          <option value="">{t('fields.noneOption')}</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        {!showAddContractor && !isReadOnly && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            className="self-start px-0 text-primary hover:bg-transparent hover:underline"
            onClick={onShowAddContractor}
          >
            {t('actions.addNewContractor')}
          </Button>
        )}
      </div>

      {showAddContractor && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background-secondary p-3">
          <Label htmlFor={newContractorId} className={fieldLabelClass}>
            {t('fields.newContractorName')}
          </Label>
          <div className="flex gap-2">
            <Input
              id={newContractorId}
              type="text"
              placeholder={t('fields.newContractorPlaceholder')}
              value={newContractorName}
              disabled={isReadOnly}
              onChange={(e) => { onChangeNewContractorName(e.target.value); }}
              invalid={contractorError !== null}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSubmitNewContractor();
                }
              }}
            />
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={isAddingContractor || isReadOnly}
              onClick={onSubmitNewContractor}
            >
              {isAddingContractor ? t('actions.adding') : t('actions.add')}
            </Button>
            <Button
              type="button"
              variant="border"
              size="md"
              disabled={isReadOnly}
              onClick={onCancelAddContractor}
            >
              {t('actions.cancel')}
            </Button>
          </div>
          {contractorError !== null && (
            <span role="alert" className={fieldErrorClass}>{contractorError}</span>
          )}
        </div>
      )}
    </div>
  );
}
