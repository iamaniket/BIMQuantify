'use client';

import {
  Download, Eye, Flag, Plus, Search, Trash2, Upload,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useMemo, useRef, useState, type JSX,
} from 'react';
import { toast } from 'sonner';

import {
  Button,
  ConfirmDialog,
  DetailCard, DetailCardBody, DetailCardFooter, DetailCardRow,
  Select, SplitButton, type SplitButtonItem,
} from '@bimstitch/ui';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { PanelToolbar } from '@/components/shared/viewer/shared/PanelToolbar';
import { getBcfTopic } from '@/lib/api/bcf';
import { useAuth } from '@/providers/AuthProvider';

import { BcfCreateForm } from './BcfCreateForm';
import { BcfTopicCard } from './BcfTopicCard';
import { BcfTopicDetail } from './BcfTopicDetail';
import type { BcfController } from './useBcfController';
import { useBcfTopics } from './useBcfTopics';
import { useDeleteBcfTopic } from './useDeleteBcfTopic';
import { useExportBcf } from './useExportBcf';
import { useImportBcf } from './useImportBcf';

type Props = {
  projectId: string;
  controller: BcfController;
  /** Bump to open the create form pre-filled (the 2D draw-first flow). */
  createNonce?: number | undefined;
  /** Called when the create form closes; `saved` true if a topic was created. */
  onCreateClose?: ((saved: boolean) => void) | undefined;
  /** Topic to expand when `openTopicNonce` changes (e.g. a markup was clicked). */
  openTopicId?: string | undefined;
  openTopicNonce?: number | undefined;
};

export function BcfTopicList({
  projectId,
  controller,
  createNonce,
  onCreateClose,
  openTopicId,
  openTopicNonce,
}: Props): JSX.Element {
  const t = useTranslations('viewer.bcf');
  const { tokens } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [createExpanded, setCreateExpanded] = useState(false);
  const [deleteTopicId, setDeleteTopicId] = useState<string | null>(null);

  const { data: topics, isLoading } = useBcfTopics(projectId, {
    search: search || undefined,
    status: statusFilter || undefined,
  });

  const importMutation = useImportBcf(projectId);
  const exportMutation = useExportBcf(projectId);
  const deleteMutation = useDeleteBcfTopic(projectId);

  const toggleTopic = useCallback((id: string) => {
    setCreateExpanded(false);
    setExpandedTopicId((prev) => (prev === id ? null : id));
  }, []);

  const toggleCreate = useCallback(() => {
    setExpandedTopicId(null);
    setCreateExpanded((prev) => !prev);
  }, []);

  // Open the create form pre-filled when a markup draft completes (2D flow).
  useEffect(() => {
    if (createNonce === undefined || createNonce === 0) return;
    setExpandedTopicId(null);
    setCreateExpanded(true);
  }, [createNonce]);

  // Expand a specific topic when a committed markup is clicked.
  useEffect(() => {
    if (openTopicNonce === undefined || openTopicNonce === 0 || openTopicId === undefined) return;
    setCreateExpanded(false);
    setExpandedTopicId(openTopicId);
  }, [openTopicNonce, openTopicId]);

  const handleRestoreView = useCallback(async (topicId: string) => {
    if (tokens === null) return;
    const topic = await getBcfTopic(tokens.access_token, projectId, topicId);
    const vp = topic.viewpoints[0];
    if (vp === undefined) return;
    await controller.applyViewpoint(vp);
  }, [controller, tokens, projectId]);

  const handleDelete = useCallback(async () => {
    if (deleteTopicId === null) return;
    try {
      await deleteMutation.mutateAsync(deleteTopicId);
      toast.success(t('deleteSuccess'));
      setExpandedTopicId(null);
      setDeleteTopicId(null);
    } catch {
      // useAuthMutation already toasts
    }
  }, [deleteMutation, deleteTopicId, t]);

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
            selectSize="md"
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
            onClick={toggleCreate}
            items={splitItems}
            menuLabel={t('moreActions')}
            variant="primary"
            size="md"
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

      {/* Scrollable list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Inline create form — toggled by the toolbar button */}
        {createExpanded && (
          <div className="border-b border-border px-3 py-3">
            <BcfCreateForm
              projectId={projectId}
              controller={controller}
              onCreated={(topicId) => {
                setCreateExpanded(false);
                setExpandedTopicId(topicId);
                onCreateClose?.(true);
              }}
              onCancel={() => {
                setCreateExpanded(false);
                onCreateClose?.(false);
              }}
            />
          </div>
        )}

        {/* Topic rows */}
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
            <DetailCard
              key={topic.id}
              expanded={expandedTopicId === topic.id}
              onToggle={() => { toggleTopic(topic.id); }}
            >
              <DetailCardRow
                actions={
                  topic.snapshot_url != null ? (
                    <button
                      type="button"
                      title={t('restoreView')}
                      onClick={(e) => { e.stopPropagation(); void handleRestoreView(topic.id); }}
                      className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-all hover:bg-background-hover hover:text-foreground"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  ) : undefined
                }
              >
                <BcfTopicCard topic={topic} />
              </DetailCardRow>
              <DetailCardBody style={{ paddingLeft: 14 }}>
                <BcfTopicDetail
                  projectId={projectId}
                  topicId={topic.id}
                />
              </DetailCardBody>
              <DetailCardFooter className="justify-between">
                {topic.snapshot_url != null ? (
                  <Button variant="ghost" size="md" onClick={() => { void handleRestoreView(topic.id); }}>
                    <Eye className="h-3.5 w-3.5" />
                    {t('restoreView')}
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => { setDeleteTopicId(topic.id); }}
                  className="text-error hover:text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('deleteIssue')}
                </Button>
              </DetailCardFooter>
            </DetailCard>
          ))}
      </div>

      <ConfirmDialog
        open={deleteTopicId !== null}
        onOpenChange={(open) => { if (!open) setDeleteTopicId(null); }}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('deleteConfirmAction')}
        cancelLabel={t('cancel')}
        variant="destructive"
        isPending={deleteMutation.isPending}
        errorMessage={null}
        onConfirm={handleDelete}
      />
    </div>
  );
}
