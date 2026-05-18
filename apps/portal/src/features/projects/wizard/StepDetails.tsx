'use client';

import { useId, type JSX } from 'react';
import { useFormContext } from 'react-hook-form';

import { Input, Label } from '@bimstitch/ui';

import type { ProjectFormValues } from '../projectFormSchema';

import {
  BUILDING_TYPE_OPTIONS,
  CONSEQUENCE_CLASS_OPTIONS,
  INSTRUMENT_OPTIONS,
  PHASE_OPTIONS,
  STATUS_OPTIONS,
} from './projectWizardSteps';
import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage, selectClass,
} from './stepStyles';

type Props = {
  isReadOnly: boolean;
};

export function StepDetails({ isReadOnly }: Props): JSX.Element {
  const form = useFormContext<ProjectFormValues>();
  const refCodeId = useId();
  const permitId = useId();
  const statusId = useId();
  const phaseId = useId();
  const deliveryId = useId();
  const buildingTypeId = useId();
  const consequenceClassId = useId();
  const instrumentId = useId();
  const plannedStartId = useId();

  const { errors } = form.formState;
  const refCodeError = getFieldErrorMessage(errors, 'reference_code');
  const permitError = getFieldErrorMessage(errors, 'permit_number');
  const deliveryError = getFieldErrorMessage(errors, 'delivery_date');
  const plannedStartError = getFieldErrorMessage(errors, 'planned_start_date');

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
            disabled={isReadOnly}
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
            disabled={isReadOnly}
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
          <select id={statusId} className={selectClass} disabled={isReadOnly} {...form.register('status')}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={phaseId} className={fieldLabelClass}>Phase</Label>
          <select id={phaseId} className={selectClass} disabled={isReadOnly} {...form.register('phase')}>
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
            disabled={isReadOnly}
            {...form.register('delivery_date')}
          />
          {deliveryError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{deliveryError}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={buildingTypeId} className={fieldLabelClass}>Type bouwwerk</Label>
          <select
            id={buildingTypeId}
            className={selectClass}
            disabled={isReadOnly}
            {...form.register('building_type')}
          >
            <option value="">—</option>
            {BUILDING_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={consequenceClassId} className={fieldLabelClass}>Gevolgklasse</Label>
          <select
            id={consequenceClassId}
            className={selectClass}
            disabled={isReadOnly}
            {...form.register('consequence_class')}
          >
            <option value="">—</option>
            {CONSEQUENCE_CLASS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={plannedStartId} className={fieldLabelClass}>Geplande startdatum</Label>
          <Input
            id={plannedStartId}
            type="date"
            invalid={plannedStartError !== undefined}
            disabled={isReadOnly}
            {...form.register('planned_start_date')}
          />
          {plannedStartError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{plannedStartError}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={instrumentId} className={fieldLabelClass}>Toegelaten instrument (Wkb)</Label>
          <select
            id={instrumentId}
            className={selectClass}
            disabled={isReadOnly}
            {...form.register('instrument_id')}
          >
            <option value="">—</option>
            {INSTRUMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} · {opt.provider}
              </option>
            ))}
          </select>
          <span className="text-caption text-foreground-tertiary">
            Bron: TloKB-register (
            <a
              href="https://www.tlokb.nl/register"
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:text-foreground-secondary"
            >
              tlokb.nl
            </a>
            )
          </span>
        </div>
      </div>
    </div>
  );
}
