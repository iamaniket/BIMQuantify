'use client';

import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Button, Panel, PanelBody, PanelHeader } from '@bimstitch/ui';

import type { Model } from '@/lib/api/schemas';
import { NewModelDialog } from '@/features/projects/NewModelDialog';

import { ModelsTableRow } from './ModelsTableRow';

type Props = {
  projectId: string;
  models: Model[];
  onUpload: (modelId: string) => void;
};

export function ModelsTab({ projectId, models, onUpload }: Props): JSX.Element {
  const [newModelOpen, setNewModelOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <PanelHeader>
          <div className="grid grid-cols-[minmax(0,1fr)_56px_88px_144px] items-center gap-4 text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
            <span>Model</span>
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
                New model
              </Button>
            </div>
          </div>
        </PanelHeader>

        <PanelBody>
          {models.length === 0 ? (
            <div className="px-4 py-10 text-center text-body3 text-foreground-tertiary">
              No models yet. Create one to get started.
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
        </PanelBody>
      </Panel>

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
