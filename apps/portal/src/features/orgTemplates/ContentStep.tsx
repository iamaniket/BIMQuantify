'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { type JSX } from 'react';

import { Badge, IconButton, Input, Switch, Textarea } from '@bimstitch/ui';

import {
  type ContentEntry,
  type SectionEntry,
  type TextEntry,
} from './orgTemplateBuilderTypes';

type MergeField = { path: string; label: string };

type ContentStepProps = {
  sections: SectionEntry[];
  sectionLabels: Map<string, string>;
  mergeFields: MergeField[];
  patchSection: (index: number, patch: Partial<ContentEntry> & Partial<TextEntry>) => void;
  moveSection: (index: number, delta: number) => void;
  removeSection: (index: number) => void;
  insertMergeField: (index: number, path: string) => void;
  addTextBlock: () => void;
};

export function ContentStep({
  sections,
  sectionLabels,
  mergeFields,
  patchSection,
  moveSection,
  removeSection,
  insertMergeField,
  addTextBlock,
}: ContentStepProps): JSX.Element {
  const tReport = useTranslations('reportTemplates');

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-caption text-foreground-tertiary">{tReport('builder.contentHint')}</span>
      <div className="flex flex-col gap-2">
        {sections.map((s, index) => (
          <div key={s.kind === 'content' ? s.key : s.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              {s.kind === 'content' ? (
                <>
                  <Switch checked={s.enabled} onChange={(e) => { patchSection(index, { enabled: e.target.checked }); }} />
                  <span className="font-sans text-body3 font-medium text-foreground">{sectionLabels.get(s.key) ?? s.key}</span>
                  <Input
                    className="ml-auto w-40"
                    placeholder={tReport('builder.titleOverridePlaceholder')}
                    value={s.titleOverride}
                    onChange={(e) => { patchSection(index, { titleOverride: e.target.value }); }}
                  />
                </>
              ) : (
                <>
                  <Badge variant="info" size="md">{tReport('builder.textBlock')}</Badge>
                  <Input
                    className="ml-1 flex-1"
                    placeholder={tReport('builder.textTitlePlaceholder')}
                    value={s.title}
                    onChange={(e) => { patchSection(index, { title: e.target.value }); }}
                  />
                </>
              )}
              <div className="flex shrink-0 items-center">
                <IconButton size="sm" aria-label={tReport('builder.moveUp')} disabled={index === 0} onClick={() => { moveSection(index, -1); }}>
                  <ChevronUp className="h-4 w-4" />
                </IconButton>
                <IconButton size="sm" aria-label={tReport('builder.moveDown')} disabled={index === sections.length - 1} onClick={() => { moveSection(index, 1); }}>
                  <ChevronDown className="h-4 w-4" />
                </IconButton>
                {s.kind === 'text' ? (
                  <IconButton size="sm" aria-label={tReport('builder.remove')} className="hover:text-error" onClick={() => { removeSection(index); }}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </div>
            </div>
            {s.kind === 'text' ? (
              <div className="flex flex-col gap-1.5">
                <Textarea
                  rows={3}
                  placeholder={tReport('builder.textBodyPlaceholder')}
                  value={s.body}
                  onChange={(e) => { patchSection(index, { body: e.target.value }); }}
                />
                {mergeFields.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {mergeFields.map((mf) => (
                      <button
                        key={mf.path}
                        type="button"
                        onClick={() => { insertMergeField(index, mf.path); }}
                        className="rounded border border-border bg-surface-low px-1.5 py-0.5 font-sans text-caption text-foreground-secondary transition-colors hover:bg-background-hover"
                      >
                        {mf.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addTextBlock}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 font-sans text-body3 text-foreground-secondary transition-colors hover:bg-background-hover"
      >
        <Plus className="h-4 w-4" />
        {tReport('builder.addTextBlock')}
      </button>
    </div>
  );
}
