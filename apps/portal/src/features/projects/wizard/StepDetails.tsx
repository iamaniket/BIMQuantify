'use client';

import { useId, type JSX } from 'react';
import { useFormContext } from 'react-hook-form';
import { useTranslations } from 'next-intl';

import { Input, Label, Select } from '@bimstitch/ui';

import { useRegisterField } from '@/hooks/useRegisterField';
import type { ProjectFormValues } from '../projectFormSchema';

import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage,
} from './stepStyles';
import { useWizardOptions } from './useWizardOptions';

type Props = {
  isReadOnly: boolean;
  country: string;
};

export function StepDetails({ isReadOnly, country }: Props): JSX.Element {
  const form = useFormContext<ProjectFormValues>();
  const t = useTranslations('projects.wizard.details');
  const refCodeId = useId();
  const permitId = useId();
  const phaseId = useId();
  const deliveryId = useId();
  const buildingTypeId = useId();
  const plannedStartId = useId();

  const { errors } = form.formState;
  const refCodeError = getFieldErrorMessage(errors, 'reference_code');
  const permitError = getFieldErrorMessage(errors, 'permit_number');
  const deliveryError = getFieldErrorMessage(errors, 'delivery_date');
  const plannedStartError = getFieldErrorMessage(errors, 'planned_start_date');
  const { phaseOptions, buildingTypeOptions } = useWizardOptions(country);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={refCodeId} className={fieldLabelClass}>{t('fields.referenceCode')}</Label>
          <Input
            id={refCodeId}
            type="text"
            placeholder={t('fields.referenceCodePlaceholder')}
            invalid={refCodeError !== undefined}
            disabled={isReadOnly}
            {...useRegisterField(form, 'reference_code')}
          />
          {refCodeError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{refCodeError}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={permitId} className={fieldLabelClass}>{t('fields.permitNumber')}</Label>
          <Input
            id={permitId}
            type="text"
            placeholder={t('fields.permitNumberPlaceholder')}
            invalid={permitError !== undefined}
            disabled={isReadOnly}
            {...useRegisterField(form, 'permit_number')}
          />
          {permitError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{permitError}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={phaseId} className={fieldLabelClass}>{t('fields.phase')}</Label>
          <Select id={phaseId} disabled={isReadOnly} {...useRegisterField(form, 'phase')}>
            {phaseOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={buildingTypeId} className={fieldLabelClass}>{t('fields.buildingType')}</Label>
          <Select
            id={buildingTypeId}
            disabled={isReadOnly}
            {...useRegisterField(form, 'building_type')}
          >
            <option value="">—</option>
            {buildingTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={deliveryId} className={fieldLabelClass}>{t('fields.deliveryDate')}</Label>
          <Input
            id={deliveryId}
            type="date"
            invalid={deliveryError !== undefined}
            disabled={isReadOnly}
            {...useRegisterField(form, 'delivery_date')}
          />
          {deliveryError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{deliveryError}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={plannedStartId} className={fieldLabelClass}>{t('fields.plannedStartDate')}</Label>
          <Input
            id={plannedStartId}
            type="date"
            invalid={plannedStartError !== undefined}
            disabled={isReadOnly}
            {...useRegisterField(form, 'planned_start_date')}
          />
          {plannedStartError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{plannedStartError}</span>
          )}
        </div>
      </div>
    </div>
  );
}
