'use client';

import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

import { Select } from '@bimdossier/ui';

import { REPORT_TEMPLATE_TYPES } from '@/lib/api/schemas/reportTemplates';

import { type TemplateCategory } from './orgTemplateBuilderTypes';

type TypeStepProps = {
  category: TemplateCategory;
  isEditing: boolean;
  reportType: string;
  onCategoryChange: (next: TemplateCategory) => void;
  onReportTypeChange: (value: string) => void;
};

export function TypeStep({
  category,
  isEditing,
  reportType,
  onCategoryChange,
  onReportTypeChange,
}: TypeStepProps): JSX.Element {
  const t = useTranslations('orgTemplates');
  const tReport = useTranslations('reportTemplates');

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={isEditing}
        onClick={() => { onCategoryChange('finding'); }}
        className={`rounded-lg border p-3 text-left transition-colors ${
          category === 'finding'
            ? 'border-primary bg-primary-lighter'
            : 'border-border bg-background hover:bg-background-hover'
        } ${isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <div className="font-sans text-body2 font-medium text-foreground">
          {t('chooser.findingOption')}
        </div>
        <div className="mt-0.5 font-sans text-caption text-foreground-tertiary">
          {t('chooser.findingDesc')}
        </div>
      </button>

      <button
        type="button"
        disabled={isEditing}
        onClick={() => { onCategoryChange('report'); }}
        className={`rounded-lg border p-3 text-left transition-colors ${
          category === 'report'
            ? 'border-primary bg-primary-lighter'
            : 'border-border bg-background hover:bg-background-hover'
        } ${isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <div className="font-sans text-body2 font-medium text-foreground">
          {t('chooser.reportOption')}
        </div>
        <div className="mt-0.5 font-sans text-caption text-foreground-tertiary">
          {t('chooser.reportDesc')}
        </div>
      </button>

      {category === 'report' && (
        <div className="mt-1">
          <label className="mb-1 block font-sans text-caption font-medium text-foreground-secondary">
            {t('chooser.reportTypeLabel')}
          </label>
          <Select
            selectSize="md"
            value={reportType}
            disabled={isEditing}
            onChange={(e) => { onReportTypeChange(e.target.value); }}
          >
            {REPORT_TEMPLATE_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {tReport(`reportTypes.${rt}` as Parameters<typeof tReport>[0])}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
