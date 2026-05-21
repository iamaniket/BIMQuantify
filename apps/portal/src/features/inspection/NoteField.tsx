'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Textarea } from '@bimstitch/ui';

type Props = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
};

export function NoteField({ value, onChange, required, disabled }: Props): JSX.Element {
  const t = useTranslations('inspection.note');

  return (
    <div className="flex flex-col gap-1">
      <label className="text-caption font-medium text-foreground-secondary">
        {t('label')}
        {required && <span className="text-error"> *</span>}
      </label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('placeholder')}
        maxLength={4000}
        rows={3}
        disabled={disabled}
        className="text-body2"
      />
      {required && value.trim().length === 0 && (
        <p className="text-caption text-error">{t('requiredForNvt')}</p>
      )}
    </div>
  );
}
