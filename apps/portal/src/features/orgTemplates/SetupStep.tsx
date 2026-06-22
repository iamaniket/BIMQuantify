'use client';

import { useTranslations } from 'next-intl';
import { type Dispatch, type SetStateAction, type JSX } from 'react';

import { Input, Label, Switch, Textarea } from '@bimstitch/ui';

import { BUILTIN_KEYS, type BuiltinState, type TemplateCategory } from './orgTemplateBuilderTypes';

type SetupStepProps = {
  category: TemplateCategory;
  isEditing: boolean;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  isDefault: boolean;
  setIsDefault: Dispatch<SetStateAction<boolean>>;
  builtins: BuiltinState;
  setBuiltins: Dispatch<SetStateAction<BuiltinState>>;
};

export function SetupStep({
  category,
  isEditing,
  name,
  setName,
  description,
  setDescription,
  isDefault,
  setIsDefault,
  builtins,
  setBuiltins,
}: SetupStepProps): JSX.Element {
  const tFinding = useTranslations('findingTemplates');
  const tBuiltins = useTranslations('findingTemplates.builtins');
  const tReport = useTranslations('reportTemplates');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tmpl-name">
            {category === 'finding' ? tFinding('builder.nameLabel') : tReport('builder.nameLabel')}
          </Label>
          <Input
            id="tmpl-name"
            autoFocus
            placeholder={category === 'finding' ? tFinding('builder.namePlaceholder') : tReport('builder.namePlaceholder')}
            value={name}
            onChange={(e) => { setName(e.target.value); }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tmpl-desc">
            {category === 'finding' ? tFinding('builder.descriptionLabel') : tReport('builder.descriptionLabel')}
          </Label>
          <Textarea
            id="tmpl-desc"
            rows={2}
            placeholder={category === 'finding' ? tFinding('builder.descriptionPlaceholder') : undefined}
            value={description}
            onChange={(e) => { setDescription(e.target.value); }}
          />
        </div>
        {!isEditing && (
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-low px-3 py-2">
            <span className="flex flex-col">
              <span className="font-sans text-body3 font-medium text-foreground">
                {category === 'finding' ? tFinding('builder.defaultLabel') : tReport('builder.defaultLabel')}
              </span>
              <span className="font-sans text-caption text-foreground-tertiary">
                {category === 'finding' ? tFinding('builder.defaultHint') : tReport('builder.defaultHint')}
              </span>
            </span>
            <Switch checked={isDefault} onChange={(e) => { setIsDefault(e.target.checked); }} />
          </label>
        )}
      </div>

      {/* Built-in fields (finding only) */}
      {category === 'finding' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-sans text-label2 font-semibold text-foreground">{tFinding('builder.builtinsTitle')}</span>
            <span className="font-sans text-caption text-foreground-tertiary">{tFinding('builder.lockedFieldsNote')}</span>
          </div>
          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {BUILTIN_KEYS.map((key) => {
              const cfg = builtins[key] ?? { visible: true, required: false };
              return (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-sans text-body3 text-foreground">{tBuiltins(key)}</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                      {tFinding('builder.show')}
                      <Switch
                        checked={cfg.visible}
                        onChange={(e) => {
                          const visible = e.target.checked;
                          setBuiltins((prev) => ({
                            ...prev,
                            [key]: { visible, required: visible ? cfg.required : false },
                          }));
                        }}
                      />
                    </label>
                    <label className="flex items-center gap-1.5 font-sans text-caption text-foreground-secondary">
                      {tFinding('builder.required')}
                      <Switch
                        checked={cfg.required}
                        disabled={!cfg.visible}
                        onChange={(e) => {
                          setBuiltins((prev) => ({ ...prev, [key]: { ...cfg, required: e.target.checked } }));
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
