'use client';

import { Plus } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Button } from '@bimstitch/ui';

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
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="grid grid-cols-[1fr_50px_100px_60px_90px] items-center gap-0 text-caption font-bold uppercase tracking-[0.1em] text-foreground-tertiary">
          <span>Model</span>
          <span>Files</span>
          <span>Score</span>
          <span>Sync</span>
          <span />
        </div>
        <Button variant="border" size="sm" onClick={() => { setNewModelOpen(true); }}>
          <Plus className="h-3.5 w-3.5" />
          New model
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-background">
        {models.length === 0 ? (
          <div className="px-4 py-8 text-center text-body3 text-foreground-tertiary">
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
      </div>

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
