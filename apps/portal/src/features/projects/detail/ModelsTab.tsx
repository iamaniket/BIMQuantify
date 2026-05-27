'use client';

import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';
import { NewModelDialog } from '@/features/models/NewModelDialog';

import { ModelsTableRow } from './ModelsTableRow';

type Props = {
  projectId: string;
  models: Model[];
  onUpload: (modelId: string) => void;
};

export function ModelsTab({ projectId, models, onUpload }: Props): JSX.Element {
  const [newModelOpen, setNewModelOpen] = useState(false);
  const t = useTranslations('projectDetail.tabs.models');

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="border-b border-border px-4 py-3">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_56px_88px_144px] items-center gap-4 text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
            <span>{t('columnName')}</span>
            <span>Type</span>
            <span className="text-center">Files</span>
            <span>Sync</span>
            <div className="flex justify-end">
              <Button
                variant="border"
                size="sm"
                className="w-full whitespace-nowrap justify-center"
                onClick={() => { setNewModelOpen(true); }}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('newModel')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          {models.length === 0 ? (
            <div className="px-4 py-10 text-center text-body3 text-foreground-tertiary">
              {t('emptyState')}
            </div>
          ) : (
            models.map((m) => (
              <ModelsTableRow
                key={m.id}
                projectId={projectId}
                model={m}
                onUpload={onUpload}
              />
            ))
          )}
        </div>
      </div>

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
