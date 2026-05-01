'use client';

import { useId, type JSX } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { Input, Label } from '@bimstitch/ui';

import type { ResolvedAddress } from '@/lib/api/pdok';

import { AddressLookup } from '../AddressLookup';
import type { ProjectFormValues } from '../projectFormSchema';

import { AddressMapPreview } from './AddressMapPreview';
import {
  fieldErrorClass, fieldLabelClass, getFieldErrorMessage,
} from './stepStyles';

export type StepAddressProps = {
  /** Optional initial label shown in the lookup input (used in edit mode). */
  initialLookupLabel: string | undefined;
};

export function StepAddress({ initialLookupLabel }: StepAddressProps): JSX.Element {
  const form = useFormContext<ProjectFormValues>();
  const streetId = useId();
  const houseId = useId();
  const postalId = useId();
  const cityId = useId();
  const municipalityId = useId();

  const { errors } = form.formState;
  const postalError = getFieldErrorMessage(errors, 'postal_code');

  // Scoped subscription so the map only re-renders when coordinates change,
  // not on every keystroke in unrelated fields.
  const [latitude, longitude] = useWatch({
    control: form.control,
    name: ['latitude', 'longitude'],
  });

  const handleAddressSelected = (addr: ResolvedAddress): void => {
    const setOpts = { shouldDirty: true, shouldTouch: true, shouldValidate: false } as const;
    form.setValue('street', addr.street ?? '', setOpts);
    form.setValue('house_number', addr.houseNumber ?? '', setOpts);
    form.setValue('postal_code', addr.postalCode ?? '', setOpts);
    form.setValue('city', addr.city ?? '', setOpts);
    form.setValue('municipality', addr.municipality ?? '', setOpts);
    form.setValue('bag_id', addr.bagId ?? '', setOpts);
    form.setValue('latitude', addr.latitude ?? undefined, setOpts);
    form.setValue('longitude', addr.longitude ?? undefined, setOpts);
  };

  return (
    <div className="flex flex-col gap-4">
      {initialLookupLabel === undefined ? (
        <AddressLookup onSelect={handleAddressSelected} />
      ) : (
        <AddressLookup
          onSelect={handleAddressSelected}
          initialLabel={initialLookupLabel}
        />
      )}

      <AddressMapPreview latitude={latitude} longitude={longitude} />

      {/* Hidden fields populated by AddressLookup; kept registered so they
          round-trip through edit mode and survive step unmount. */}
      <input type="hidden" {...form.register('bag_id')} />
      <input type="hidden" {...form.register('latitude', { valueAsNumber: true })} />
      <input type="hidden" {...form.register('longitude', { valueAsNumber: true })} />

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={streetId} className={fieldLabelClass}>Street</Label>
          <Input
            id={streetId}
            type="text"
            placeholder="Hoofdstraat"
            {...form.register('street')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={houseId} className={fieldLabelClass}>House number</Label>
          <Input
            id={houseId}
            type="text"
            placeholder="12A"
            {...form.register('house_number')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={postalId} className={fieldLabelClass}>Postal code</Label>
          <Input
            id={postalId}
            type="text"
            placeholder="1234 AB"
            invalid={postalError !== undefined}
            {...form.register('postal_code')}
          />
          {postalError !== undefined && (
            <span role="alert" className={fieldErrorClass}>{postalError}</span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={cityId} className={fieldLabelClass}>City</Label>
          <Input
            id={cityId}
            type="text"
            placeholder="Amsterdam"
            {...form.register('city')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={municipalityId} className={fieldLabelClass}>Municipality</Label>
          <Input
            id={municipalityId}
            type="text"
            placeholder="Amsterdam"
            {...form.register('municipality')}
          />
        </div>
      </div>
    </div>
  );
}
