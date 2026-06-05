'use client';

import { Box, Plus } from '@bimstitch/ui/icons';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Button, EmptyState } from '@bimstitch/ui';

import { ResourceList, TabToolbar } from '@/components/shared/resource';
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
  const [searchQuery, setSearchQuery] = useState('');
  const t = useTranslations('projectDetail.tabs.models');

  const filtered = searchQuery === ''
    ? models
    : models.filter((m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <TabToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setNewModelOpen(true); }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('newModel')}
          </Button>
        }
      />

      <ResourceList
        isLoading={false}
        total={models.length}
        filteredCount={filtered.length}
        searchActive={searchQuery !== ''}
        noResultsLabel={t('noResults')}
        empty={(
          <EmptyState
            icon={Box}
            title={t('emptyState')}
            description={t('emptyDescription')}
            action={(
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setNewModelOpen(true); }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('newModel')}
              </Button>
            )}
            className={undefined}
          />
        )}
      >
        {filtered.map((m) => (
          <ModelsTableRow
            key={m.id}
            projectId={projectId}
            model={m}
            isOpen={expandedId === m.id}
            onToggle={() => { setExpandedId(expandedId === m.id ? null : m.id); }}
          />
        ))}
      </ResourceList>

      <NewModelDialog
        open={newModelOpen}
        onOpenChange={setNewModelOpen}
        projectId={projectId}
      />
    </div>
  );
}
