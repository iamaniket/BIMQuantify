'use client';

import { Camera, LayoutGrid, Table2, Upload } from '@bimstitch/ui/icons';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { Badge, Button, Select, Skeleton, SplitButton, TabsContent } from '@bimstitch/ui';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { PageShell } from '@/components/shared/layout/PageShell';
import { TabbedPageShell } from '@/components/shared/layout/TabbedPageShell';
import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { AttachmentViewerDialog } from '@/features/attachments/AttachmentViewerDialog';
import { CaptureLinksList } from '@/features/attachments/CaptureLinksList';
import { CreateCaptureLinkDialog } from '@/features/attachments/CreateCaptureLinkDialog';
import { ProjectAttachmentsHero } from '@/features/attachments/ProjectAttachmentsHero';
import { ProjectAttachmentsOverview } from '@/features/attachments/ProjectAttachmentsOverview';
import { ProjectAttachmentsTable } from '@/features/attachments/ProjectAttachmentsTable';
import { useAttachments } from '@/features/attachments/useAttachments';
import { useDeleteAttachment } from '@/features/attachments/useDeleteAttachment';
import { useUploadAttachment } from '@/features/attachments/useUploadAttachment';
import { useProjectPermissions } from '@/features/permissions';
import { useProject } from '@/features/projects/useProject';
import { getAttachmentDownloadUrl } from '@/lib/api/attachments';
import { ApiError } from '@/lib/api/client';
import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas';
import { useAllInfinitePages } from '@/lib/query/useAllInfinitePages';
import { useClientPagination } from '@/lib/query/useTableQuery';
import {
  buildCaptureMetadata,
  requestGeolocation,
  type GeolocationResult,
} from '@/lib/upload/captureMetadata';
import { useAuth } from '@/providers/AuthProvider';

const CATEGORY_FILTERS: Array<{ value: AttachmentCategoryValue | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'filterAll' },
  { value: 'image', labelKey: 'filterImage' },
  { value: 'video', labelKey: 'filterVideo' },
  { value: 'audio', labelKey: 'filterAudio' },
  { value: 'office', labelKey: 'filterOffice' },
];

/**
 * Dedicated per-project Attachments page — the shared "hero + tabbed" pattern
 * (Findings / Reports / Certificates). Overview tab (totals, by-category) plus a
 * sortable / paginated / searchable file list. The full set is drained from the
 * infinite query and paged client-side. Upload (with geolocation capture
 * metadata) and capture links are driven from the list toolbar.
 */
export default function ProjectAttachmentsPage(): JSX.Element {
  const t = useTranslations('attachments.hub');
  const tAtt = useTranslations('projectDetail.tabs.attachments');
  const params = useParams<{ projectId: string }>();
  const { projectId } = params;
  const { tokens } = useAuth();

  const [tab, setTab] = useState('list');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AttachmentCategoryValue | undefined>(undefined);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [captureLinkDialogOpen, setCaptureLinkDialogOpen] = useState(false);
  const [showCaptureLinks, setShowCaptureLinks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<GeolocationResult>({ status: 'unavailable' });

  useEffect(() => {
    void requestGeolocation().then((result) => { geoRef.current = result; });
  }, []);

  const projectQuery = useProject(projectId);
  const attachmentsQuery = useAttachments(projectId);
  const attachments = useAllInfinitePages(attachmentsQuery);
  const uploadMutation = useUploadAttachment(projectId);
  const deleteMutation = useDeleteAttachment(projectId);
  const { can } = useProjectPermissions(projectId);
  const canUpload = can('attachment', 'create');
  const canDelete = can('attachment', 'delete');
  const canCreateCaptureLink = can('capture_link', 'create');

  const projectName = projectQuery.data?.name;
  const crumbs = useMemo(
    () => (projectName === undefined
      ? null
      : [
        { label: t('crumbProjects'), href: '/projects' },
        { label: projectName, href: `/projects/${projectId}` },
        { label: t('crumb'), href: undefined },
      ]),
    [projectName, projectId, t],
  );
  useHeaderCrumbsOverride(crumbs);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return attachments.items.filter((a) => {
      if (categoryFilter !== undefined && (a.attachment_category ?? 'other') !== categoryFilter) return false;
      if (query !== '') return a.original_filename.toLowerCase().includes(query);
      return true;
    });
  }, [attachments.items, search, categoryFilter]);

  const table = useClientPagination<Attachment>(filtered, {
    sortAccessors: {
      filename: (a) => a.original_filename,
      category: (a) => a.attachment_category ?? 'other',
      size: (a) => a.size_bytes,
      created_at: (a) => a.created_at,
    },
    initialSort: { key: 'created_at', dir: 'desc' },
    isLoading: attachments.isLoading,
    isError: attachments.isError,
  });

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files === null) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file !== undefined) {
          void buildCaptureMetadata(file, 'file_picker', geoRef.current).then((metadata) => {
            uploadMutation.mutate(
              { file, capture_metadata: metadata as unknown as Record<string, unknown> },
              { onSuccess: () => { toast.success(tAtt('uploadSuccess', { name: file.name })); } },
            );
          });
        }
      }
      if (fileInputRef.current !== null) fileInputRef.current.value = '';
    },
    [uploadMutation, tAtt],
  );

  const handleDownload = useCallback(
    async (att: Attachment) => {
      if (tokens === null) return;
      try {
        const resp = await getAttachmentDownloadUrl(tokens.access_token, projectId, att.id);
        window.open(resp.download_url, '_blank');
      } catch {
        toast.error(tAtt('downloadError'));
      }
    },
    [tokens, projectId, tAtt],
  );

  const handleDelete = useCallback(
    (att: Attachment) => {
      deleteMutation.mutate(att.id, {
        onSuccess: () => { toast.success(tAtt('deleteSuccess', { name: att.original_filename })); },
      });
    },
    [deleteMutation, tAtt],
  );

  if (projectQuery.isLoading) {
    return (
      <PageShell
        hero={(
          <div className="relative flex h-full items-center gap-5 bg-surface-main px-5 py-4">
            <Skeleton className="h-[112px] w-[160px] rounded-[10px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        )}
      >
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="p-6">
        <ErrorBanner
          message={isNotFound ? t('projectNotFound') : t('projectLoadError')}
          tone="soft"
          className="text-body2"
        />
      </main>
    );
  }

  const project = projectQuery.data;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  const captureItems = [
    {
      id: 'capture-link',
      label: tAtt('captureLink'),
      icon: <Camera className="h-4 w-4" />,
      onSelect: () => { setShowCaptureLinks((prev) => !prev); },
    },
    ...(canCreateCaptureLink ? [{
      id: 'create-capture-link',
      label: tAtt('captureLinkCreate'),
      icon: <Camera className="h-4 w-4" />,
      onSelect: () => { setShowCaptureLinks(true); setCaptureLinkDialogOpen(true); },
    }] : []),
  ];

  const panelHeading = {
    overview: { eyebrow: t('panel.overviewEyebrow'), title: t('panel.overviewTitle') },
    list: { eyebrow: t('panel.listEyebrow'), title: t('panel.listTitle', { count: table.total }) },
  }[tab] ?? { eyebrow: '', title: '' };

  return (
    <TabbedPageShell
      hero={<ProjectAttachmentsHero projectName={project.name} attachments={attachments.items} />}
      tabs={[
        { value: 'overview', label: t('tabs.overview'), icon: <LayoutGrid className="h-4 w-4" /> },
        {
          value: 'list',
          label: t('tabs.list'),
          icon: <Table2 className="h-4 w-4" />,
          badge: <Badge variant="primary" size="md" bordered={false}>{table.total}</Badge>,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
      panelHeading={panelHeading}
      fillContent={tab === 'list'}
      toolbar={tab === 'list' ? (
        <TableToolbar
          actions={canUpload ? (
            <SplitButton
              label={tAtt('uploadButton')}
              icon={<Upload className="h-3.5 w-3.5" />}
              disabled={uploadMutation.isPending}
              onClick={() => { fileInputRef.current?.click(); }}
              menuLabel={tAtt('captureLink')}
              items={captureItems}
            />
          ) : undefined}
        >
          <SearchInput
            placeholder={t('list.searchPlaceholder')}
            value={search}
            onChange={setSearch}
            aria-label={t('list.searchPlaceholder')}
          />
          <Select
            selectSize="md"
            className="w-auto shrink-0"
            value={categoryFilter ?? 'all'}
            onChange={(e) => { setCategoryFilter(e.target.value === 'all' ? undefined : e.target.value as AttachmentCategoryValue); }}
          >
            {CATEGORY_FILTERS.map(({ value, labelKey }) => (
              <option key={value} value={value}>{tAtt(labelKey)}</option>
            ))}
          </Select>
        </TableToolbar>
      ) : undefined}
      afterTabs={(
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept="image/*,video/*,audio/*,.pdf,.docx,.xlsx,.pptx,.txt"
            onChange={(e) => { void handleFileChange(e); }}
          />
          <CreateCaptureLinkDialog
            projectId={projectId}
            open={captureLinkDialogOpen}
            onOpenChange={setCaptureLinkDialogOpen}
          />
          <AttachmentViewerDialog
            attachment={viewing}
            projectId={projectId}
            open={viewing !== null}
            onOpenChange={(o) => { if (!o) setViewing(null); }}
            onReplaced={setViewing}
          />
        </>
      )}
    >
      <TabsContent value="overview" className="mt-0">
        {attachments.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ProjectAttachmentsOverview attachments={attachments.items} onView={setViewing} />
        )}
      </TabsContent>

      <TabsContent value="list" className="mt-0 flex min-h-0 flex-1 flex-col">
        {uploadMutation.isPending && (
          <div className="mx-5 mt-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2 text-caption text-foreground-secondary">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {tAtt('uploading')}
            </div>
          </div>
        )}
        {showCaptureLinks && (
          <div className="mx-5 mt-3 space-y-2 rounded-lg border border-border bg-surface-low p-3">
            <div className="flex items-center justify-between">
              <div className="text-body3 font-semibold text-foreground">{tAtt('captureLink')}</div>
              {canCreateCaptureLink && (
                <Button variant="border" size="md" onClick={() => { setCaptureLinkDialogOpen(true); }}>
                  {tAtt('captureLinkCreate')}
                </Button>
              )}
            </div>
            <CaptureLinksList projectId={projectId} />
          </div>
        )}
        <ProjectAttachmentsTable
          table={table}
          canDelete={canDelete}
          onView={setViewing}
          onDownload={(att) => { void handleDownload(att); }}
          onDelete={handleDelete}
        />
        <TablePaginationFooter
          table={table}
          className="shrink-0 border-t border-border px-5 py-2.5"
        />
      </TabsContent>
    </TabbedPageShell>
  );
}
