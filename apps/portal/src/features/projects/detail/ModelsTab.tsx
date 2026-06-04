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
};

export function ModelsTab({ projectId, models }: Props): JSX.Element {
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const t = useTranslations('projectDetail.tabs.models');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end px-1">
        <Button
          variant="primary"
          size="sm"
          onClick={() => { setNewModelOpen(true); }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t('newModel')}
        </Button>
      </div>

      {models.length === 0 ? (
        <div className="px-4 py-10 text-center text-body3 text-foreground-tertiary">
          {t('emptyState')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {models.map((m) => (
            <ModelsTableRow
              key={m.id}
              projectId={projectId}
              model={m}
              isOpen={expandedId === m.id}
              onToggle={() => { setExpandedId(expandedId === m.id ? null : m.id); }}
            />
          ))}
        </div>
      )}

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
