'use client';

import {
  Download, Flag, Plus, Search, Upload,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useMemo, useRef, useState, type JSX,
} from 'react';
import { toast } from 'sonner';

import { Select, SplitButton, type SplitButtonItem } from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelToolbar } from '@/components/shared/viewer/shared/PanelToolbar';

import { BcfTopicCard } from './BcfTopicCard';
import { useBcfTopics } from './useBcfTopics';
import { useExportBcf } from './useExportBcf';
import { useImportBcf } from './useImportBcf';

type Props = {
  projectId: string;
  onSelect: (topicId: string) => void;
  onCreateNew: () => void;
};

export function BcfTopicList({
  projectId,
  onSelect,
  onCreateNew,
}: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: topics, isLoading } = useBcfTopics(projectId, {
    search: search || undefined,
    status: statusFilter || undefined,
  });

  const importMutation = useImportBcf(projectId);
  const exportMutation = useExportBcf(projectId);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file === undefined) return;
      try {
        const result = await importMutation.mutateAsync(file);
        toast.success(
          t('importSuccess', { count: result.imported_count }),
        );
      } catch {
        // useAuthMutation already toasts the error
      }
      // Reset input so the same file can be re-imported
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [importMutation, t],
  );

  const handleExport = useCallback(async () => {
    try {
      await exportMutation.mutateAsync();
    } catch {
      // useAuthMutation already toasts the error
    }
  }, [exportMutation]);

  const splitItems: SplitButtonItem[] = useMemo(
    () => [
      {
        id: 'import',
        label: t('import'),
        icon: <Upload className="h-3.5 w-3.5" />,
        onSelect: () => { fileInputRef.current?.click(); },
        disabled: importMutation.isPending,
      },
      {
        id: 'export',
        label: t('export'),
        icon: <Download className="h-3.5 w-3.5" />,
        onSelect: handleExport,
        disabled: exportMutation.isPending,
      },
    ],
    [t, importMutation.isPending, exportMutation.isPending, handleExport],
  );

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        {/* Row 1: Search bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-tertiary" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="h-8 w-full rounded border border-border bg-background pl-7 pr-2 font-sans text-body3 text-foreground placeholder:text-foreground-tertiary focus:border-primary focus:outline-none"
          />
        </div>

        {/* Row 2: Status filter dropdown + Split action button */}
        <div className="flex items-center gap-2">
          <Select
            selectSize="sm"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); }}
            className="min-w-0 flex-1"
          >
            <option value="">{t('filter.allStatuses')}</option>
            <option value="Open">{t('status.open')}</option>
            <option value="In Progress">{t('status.in_progress')}</option>
            <option value="Closed">{t('status.closed')}</option>
          </Select>

          <SplitButton
            label={t('createIssue')}
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={onCreateNew}
            items={splitItems}
            menuLabel={t('moreActions')}
            variant="primary"
            size="sm"
            className="shrink-0"
          />
        </div>
      </PanelToolbar>

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".bcf,.bcfzip,.zip"
        className="hidden"
        onChange={handleImport}
      />

      {/* Topic list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <p className="text-caption text-foreground-tertiary">
              {t('loading')}
            </p>
          </div>
        )}
        {!isLoading && (topics === undefined || topics.length === 0) && (
          <PanelEmptyState
            icon={Flag}
            message={search ? t('noSearchResults') : t('emptyState')}
          />
        )}
        {!isLoading &&
          topics !== undefined &&
          topics.map((topic) => (
            <BcfTopicCard
              key={topic.id}
              topic={topic}
              onClick={() => { onSelect(topic.id); }}
            />
          ))}
      </div>
    </div>
  );
}
