'use client';

import { AlertTriangle, Loader2, Plus, Search } from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { Badge, Button, Input, SplitButton, type SplitButtonItem } from '@bimstitch/ui';
import { DetailCard, DetailCardBody, DetailCardRow } from '@bimstitch/ui';

import type { DocumentViewerHandle, ViewerHandle } from '@bimstitch/viewer';

import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { LoadMoreButton } from '@/components/shared/resource/LoadMoreButton';
import { useFindingTemplates } from '@/features/findingTemplates/useFindingTemplates';
import { useElementFindings } from '@/features/findings/useElementFindings';
import { useFileFindings, useProjectFindings } from '@/features/findings/useFindings';
import { flattenPages, totalFromPages } from '@/lib/query/useAuthInfiniteQuery';
import { FindingCreateForm } from '@/features/projects/detail/FindingCreateForm';
import { FindingDetailForm } from '@/features/projects/detail/FindingDetailForm';
import {
  severityBadgeVariant,
  statusBadgeVariant,
} from '@/features/projects/detail/findingBadges';
import type { FindingTemplate, LinkedFileTypeValue } from '@/lib/api/schemas';
import { formatDate } from '@/lib/formatting/dates';
import type { Locale } from '@bimstitch/i18n';

import { consumePendingElementPoint } from './pendingElementPoint';
import { consumePendingPdfContextPoint } from './pendingPdfContextPoint';

/**
 * How the findings shown here are scoped. The 3D viewer scopes by IFC element
 * (`globalId`, with `modelId`/`fileId` provenance) or by the whole project
 * (unlinked); the PDF viewer scopes by the open file. The body renders
 * identically for all three — only the query and the create link-vars differ.
 */
export type FindingsScope =
  | { kind: 'element'; modelId: string; fileId: string; globalId: string }
  | { kind: 'project' }
  | { kind: 'file'; fileId: string }
  // The 2D floor plan: findings are IFC-anchored to the model (world {x,y,z} at
  // the clicked storey-floor spot) and listed by file, so they round-trip as
  // markers on the plan and in 3D. Created with no element link (coordinate
  // only); the world point is handed off via the pending-element-point stash.
  | { kind: 'floorplanIfc'; modelId: string; fileId: string };

const LINKED_FILE_TYPE_BY_SCOPE = {
  element: 'ifc',
  file: 'pdf',
  project: null,
  floorplanIfc: 'ifc',
} as const;

type EntityFindingsBodyProps = {
  projectId: string;
  scope: FindingsScope;
  /** When this nonce changes, auto-open the inline new-finding form. */
  autoOpenNonce?: number | undefined;
  /** Called once the nonce has been consumed so the parent can clear it. */
  onAutoOpenConsumed?: () => void;
  /** Expand this finding's row when `openFindingNonce` changes (marker click). */
  openFindingId?: string | undefined;
  openFindingNonce?: number | undefined;
  documentHandle?: DocumentViewerHandle | null | undefined;
  viewerHandle?: ViewerHandle | null | undefined;
  activeFileType?: LinkedFileTypeValue | null | undefined;
  onNavigateToPage?: ((page: number) => void) | undefined;
};

export function EntityFindingsBody({
  projectId,
  scope,
  autoOpenNonce,
  onAutoOpenConsumed,
  openFindingId,
  openFindingNonce,
  documentHandle,
  viewerHandle,
  activeFileType,
  onNavigateToPage,
}: EntityFindingsBodyProps): JSX.Element {
  const t = useTranslations('viewerFindings');
  const tSeverity = useTranslations('findings.severity');
  const tStatus = useTranslations('findings.status');
  const tPicker = useTranslations('findingTemplates.picker');
  const locale = useLocale() as Locale;

  // Resolve the active query unconditionally (Hooks rules) — inapplicable
  // queries are disabled via their `enabled`/null args.
  const elementScope = scope.kind === 'element' ? scope : null;
  // Both PDF `file` and floor-plan `floorplanIfc` scopes list findings by file.
  const fileFindingsFileId =
    scope.kind === 'file' || scope.kind === 'floorplanIfc' ? scope.fileId : null;
  const elementQuery = useElementFindings(
    projectId,
    elementScope?.modelId ?? '',
    elementScope?.globalId ?? null,
  );
  const projectQuery = useProjectFindings(projectId, scope.kind === 'project');
  const fileQuery = useFileFindings(projectId, fileFindingsFileId);
  const query =
    scope.kind === 'project' ? projectQuery
    : scope.kind === 'file' || scope.kind === 'floorplanIfc' ? fileQuery
    : elementQuery;
  const { data: templatesData } = useFindingTemplates();
  const templates = templatesData ?? [];
  const defaultTemplate = templates.find((tpl) => tpl.is_default) ?? null;
  const [createExpanded, setCreateExpanded] = useState(false);
  const [chosenTemplate, setChosenTemplate] = useState<FindingTemplate | null>(null);
  // 3D pick point handed off by the context menu, anchored onto the new finding.
  const [pendingPoint, setPendingPoint] = useState<Record<string, number> | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const lastConsumedNonce = useRef<number | undefined>(undefined);
  const lastOpenNonce = useRef<number | undefined>(undefined);

  const findings = flattenPages(query.data);

  // Open the inline create form, consuming a pending 3D pick point for element
  // scope or a pending 2D PDF context point for file scope, so the new finding
  // anchors to the clicked location. Manual opens (no pick) carry none.
  const openCreate = useCallback((tpl: FindingTemplate | null) => {
    if (scope.kind === 'element' || scope.kind === 'floorplanIfc') {
      // Both anchor to a 3D world point handed off via the element-point stash.
      setPendingPoint(consumePendingElementPoint());
    } else if (scope.kind === 'file') {
      const pdfPt = consumePendingPdfContextPoint();
      setPendingPoint(pdfPt ? { x: pdfPt.x, y: pdfPt.y, page: pdfPt.page } : null);
    } else {
      setPendingPoint(null);
    }
    setChosenTemplate(tpl);
    setExpandedId(null);
    setCreateExpanded(true);
  }, [scope]);

  const pickerItems: SplitButtonItem[] = [
    ...templates.map((tpl) => ({
      id: tpl.id,
      label: tpl.is_default ? `${tpl.name} (${tPicker('defaultSuffix')})` : tpl.name,
      onSelect: () => { openCreate(tpl); },
    })),
    { id: '__standard__', label: tPicker('standardForm'), onSelect: () => { openCreate(null); } },
  ];

  // Auto-open the new-finding form when triggered from a context-menu command.
  useEffect(() => {
    if (autoOpenNonce !== undefined && autoOpenNonce !== lastConsumedNonce.current) {
      lastConsumedNonce.current = autoOpenNonce;
      openCreate(defaultTemplate);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenNonce, onAutoOpenConsumed, openCreate, defaultTemplate]);

  // Expand a specific finding when its marker is clicked. Depends on `findings`
  // so it re-fires once the (possibly still-loading) scoped query resolves;
  // `lastOpenNonce` keeps it idempotent against unrelated re-renders.
  useEffect(() => {
    if (openFindingNonce === undefined || openFindingNonce === lastOpenNonce.current) return;
    if (openFindingId === undefined) return;
    if (!findings.some((f) => f.id === openFindingId)) return;
    lastOpenNonce.current = openFindingNonce;
    setSearch('');
    setCreateExpanded(false);
    setExpandedId(openFindingId);
  }, [openFindingNonce, openFindingId, findings]);

  const filteredFindings = useMemo(() => {
    if (search.trim() === '') return findings;
    const q = search.toLowerCase();
    return findings.filter((f) => {
      if (f.title.toLowerCase().includes(q)) return true;
      return f.description !== null && f.description !== undefined && f.description.toLowerCase().includes(q);
    });
  }, [findings, search]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border bg-background px-2.5 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <Input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            placeholder={t('filterPlaceholder')}
            inputSize="md"
            className="pl-7"
          />
        </div>
        {templates.length > 0 ? (
          <SplitButton
            label={t('createButton')}
            icon={<Plus className="mr-1 h-3.5 w-3.5" />}
            onClick={() => { openCreate(defaultTemplate); }}
            items={pickerItems}
            menuLabel={tPicker('menuLabel')}
            variant="primary"
            size="md"
          />
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => { openCreate(null); }}
            title={t('createButton')}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('createButton')}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Inline create form — toggled by the toolbar button / context menu. */}
        {createExpanded && (
          <div className="border-b border-border px-3 py-3">
            <FindingCreateForm
              projectId={projectId}
              template={chosenTemplate}
              linkedModelId={scope.kind === 'element' || scope.kind === 'floorplanIfc' ? scope.modelId : null}
              linkedFileId={scope.kind === 'project' ? null : scope.fileId}
              linkedElementGlobalId={scope.kind === 'element' ? scope.globalId : null}
              linkedPoint={pendingPoint}
              linkedFileType={LINKED_FILE_TYPE_BY_SCOPE[scope.kind]}
              documentHandle={documentHandle}
              viewerHandle={viewerHandle}
              onCreated={(id) => {
                setCreateExpanded(false);
                setPendingPoint(null);
                setExpandedId(id);
              }}
              onCancel={() => {
                setCreateExpanded(false);
                setPendingPoint(null);
              }}
            />
          </div>
        )}

        {query.isLoading ? (
          <PanelEmptyState icon={Loader2} message={t('loading')} />
        ) : filteredFindings.length === 0 ? (
          !createExpanded && (
            <PanelEmptyState
              icon={AlertTriangle}
              message={
                scope.kind === 'project'
                  ? t('emptyProjectEmpty')
                  : scope.kind === 'file'
                    ? t('emptyFileEmpty')
                    : t('emptyNoItems')
              }
            />
          )
        ) : (
          <div className="flex flex-col">
            {filteredFindings.map((finding) => {
              const isExpanded = expandedId === finding.id;

              return (
                <DetailCard
                  key={finding.id}
                  expanded={isExpanded}
                  onToggle={() => {
                    setCreateExpanded(false);
                    setExpandedId(isExpanded ? null : finding.id);
                    if (!isExpanded && finding.anchor_page != null && onNavigateToPage) {
                      onNavigateToPage(finding.anchor_page);
                    }
                  }}
                >
                  <DetailCardRow
                    media={
                      <AlertTriangle className="h-5 w-5 text-foreground-tertiary" aria-hidden />
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body3 font-semibold leading-tight text-foreground">
                        {finding.title}
                      </span>
                      <Badge variant={severityBadgeVariant(finding.severity)} size="md" bordered>
                        {tSeverity(finding.severity)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 overflow-hidden font-sans text-[11px] leading-tight text-foreground-tertiary tabular-nums">
                      {finding.deadline_date !== null && (
                        <>
                          <span className="shrink-0">{formatDate(finding.deadline_date, locale)}</span>
                          <span className="shrink-0">·</span>
                        </>
                      )}
                      <Badge variant={statusBadgeVariant(finding.status)} size="md" className="w-fit shrink-0">
                        {tStatus(finding.status)}
                      </Badge>
                    </div>
                  </DetailCardRow>

                  <DetailCardBody>
                    <FindingDetailForm
                      projectId={projectId}
                      finding={finding}
                      onDeleted={() => { setExpandedId(null); }}
                      documentHandle={documentHandle}
                      viewerHandle={viewerHandle}
                      activeFileType={activeFileType ?? LINKED_FILE_TYPE_BY_SCOPE[scope.kind]}
                    />
                  </DetailCardBody>
                </DetailCard>
              );
            })}
            <div className="px-2.5 pb-2">
              <LoadMoreButton
                hasNextPage={query.hasNextPage}
                isFetchingNextPage={query.isFetchingNextPage}
                fetchNextPage={() => { void query.fetchNextPage(); }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Reads element-finding count via the same hook — drives the tab pill. */
export function useEntityFindingCount(
  projectId: string,
  modelId: string,
  globalId: string | null,
): number {
  const query = useElementFindings(projectId, modelId, globalId);
  return totalFromPages(query.data);
}
