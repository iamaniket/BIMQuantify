'use client';

import { useId, type JSX } from 'react';
import { useFormContext } from 'react-hook-form';

import { Input, Label } from '@bimstitch/ui';

import type { ProjectFormValues } from '../projectFormSchema';

import {
  PHASE_OPTIONS, STATUS_OPTIONS,
} from './projectWizardSteps';
import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage, selectClass,
} from './stepStyles';

export function StepDetails(): JSX.Element {
  const form = useFormContext<ProjectFormValues>();
  const refCodeId = useId();
  const permitId = useId();
  const statusId = useId();
  const phaseId = useId();
  const deliveryId = useId();

  const { errors } = form.formState;
  const refCodeError = getFieldErrorMessage(errors, 'reference_code');
  const permitError = getFieldErrorMessage(errors, 'permit_number');
  const deliveryError = getFieldErrorMessage(errors, 'delivery_date');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={refCodeId} className={fieldLabelClass}>Reference code</Label>
          <Input
            id={refCodeId}
            type="text"
            placeholder="WKB-2026-0411"
            invalid={refCodeError !== undefined}
            {...form.register('reference_code')}
          />
          {refCodeError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{refCodeError}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={permitId} className={fieldLabelClass}>Permit number</Label>
          <Input
            id={permitId}
            type="text"
            placeholder="OV-2026-0099"
            invalid={permitError !== undefined}
            {...form.register('permit_number')}
          />
          {permitError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{permitError}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={statusId} className={fieldLabelClass}>Status</Label>
          <select id={statusId} className={selectClass} {...form.register('status')}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={phaseId} className={fieldLabelClass}>Phase</Label>
          <select id={phaseId} className={selectClass} {...form.register('phase')}>
            {PHASE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={deliveryId} className={fieldLabelClass}>Delivery date</Label>
          <Input
            id={deliveryId}
            type="date"
            invalid={deliveryError !== undefined}
            {...form.register('delivery_date')}
          />
          {deliveryError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{deliveryError}</span>
          )}
        </div>
      </div>
    </div>
  );
}
