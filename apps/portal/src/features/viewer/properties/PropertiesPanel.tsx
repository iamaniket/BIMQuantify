'use client';

import { Info } from 'lucide-react';
import { useMemo, useState, useCallback, type JSX } from 'react';

import type {
  ElementEntry,
  ModelMetadata,
  ModelProperties,
} from '@/lib/api/viewerTypes';
import {
  useViewerEntityStore,
  parseEntityKey,
} from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { ElementHeader } from './ElementHeader';
import { PropertiesToolbar } from './PropertiesToolbar';
import { PropertySetGroup } from './PropertySetGroup';

type PropertiesPanelProps = {
  metadata: ModelMetadata | undefined;
  properties: ModelProperties | undefined;
  isLoadingProperties: boolean;
};

/** Count matching properties across all psets for a filter query. */
function countFiltered(
  psetEntries: [string, Record<string, unknown>][],
  q: string,
): number {
  if (!q) return psetEntries.reduce((s, [, pset]) => s + Object.keys(pset).length, 0);
  const lower = q.toLowerCase();
  let count = 0;
  for (const [, pset] of psetEntries) {
    for (const [k, v] of Object.entries(pset)) {
      if (
        k.toLowerCase().includes(lower) ||
        String(v ?? '').toLowerCase().includes(lower)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

export function PropertiesPanel({
  metadata,
  properties,
  isLoadingProperties,
}: PropertiesPanelProps): JSX.Element {
  const selected = useViewerEntityStore((s) => s.selected);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);

  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const elementsByExpressId = useMemo(() => {
    const map = new Map<number, ElementEntry>();
    if (!metadata?.elements) return map;
    for (const el of metadata.elements) {
      map.set(el.expressID, el);
    }
    return map;
  }, [metadata]);

  const selectedElement = useMemo((): ElementEntry | null => {
    if (selected.size === 0) return null;
    const firstKey = selected.values().next().value;
    if (firstKey === undefined) return null;
    const parsed = parseEntityKey(firstKey);
    if (!parsed) return null;
    return elementsByExpressId.get(parsed.localId) ?? null;
  }, [selected, elementsByExpressId]);

  const elementProps =
    selectedElement?.globalId != null && properties
      ? properties[selectedElement.globalId]
      : undefined;

  const psetEntries = useMemo(
    () =>
      elementProps
        ? Object.entries(elementProps).filter(
            ([key, value]) =>
              key !== '_element_type' &&
              typeof value === 'object' &&
              value !== null,
          )
        : [],
    [elementProps],
  );

  // Compute shown / total for the header counter
  const total = psetEntries.reduce(
    (s, [, pset]) => s + Object.keys(pset as Record<string, unknown>).length,
    0,
  );
  const shown = filter
    ? countFiltered(psetEntries as [string, Record<string, unknown>][], filter)
    : total;

  // Track whether all groups are expanded
  const allExpanded =
    psetEntries.length > 0 &&
    psetEntries.every(([name]) => openGroups[name] ?? true);

  const handleToggleExpand = useCallback(() => {
    if (allExpanded) {
      setOpenGroups({});
    } else {
      setOpenGroups(
        Object.fromEntries(psetEntries.map(([name]) => [name, true])),
      );
    }
  }, [allExpanded, psetEntries]);

  // ── Empty states ──────────────────────────────────────────────────

  if (selectedAll) {
    const count = metadata?.totalElements ?? 0;
    return (
      <PanelEmptyState
        icon={Info}
        message={`All ${count.toLocaleString()} elements selected. Select a single element to inspect its properties.`}
      />
    );
  }

  if (selected.size === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: 'var(--fg-3)', opacity: 0.7 }}
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.3 7 12 12 20.7 7" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
        <span
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--fg-2)',
          }}
        >
          No selection
        </span>
        <p
          className="text-foreground-tertiary"
          style={{ fontFamily: 'var(--sans)', fontSize: 12.5 }}
        >
          Click an element in the viewer to inspect its property sets.
        </p>
      </div>
    );
  }

  if (!selectedElement) {
    return (
      <PanelEmptyState
        icon={Info}
        message="Element data not available. Re-extract the model to populate properties."
      />
    );
  }

  // ── Main content ──────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col" style={{ fontFamily: 'var(--sans)' }}>
      <ElementHeader
        name={selectedElement.name}
        type={selectedElement.type}
        globalId={selectedElement.globalId}
        selectionCount={selected.size}
      />

      <PropertiesToolbar
        query={filter}
        onQueryChange={setFilter}
        isAllExpanded={allExpanded}
        onToggleExpand={handleToggleExpand}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoadingProperties ? (
          <PanelEmptyState message="Loading properties…" />
        ) : psetEntries.length === 0 ? (
          <PanelEmptyState message="No property sets found for this element." />
        ) : (
          <>
            {psetEntries.map(([psetName, pset], idx) => (
              <PropertySetGroup
                key={psetName}
                name={psetName}
                properties={pset}
                open={openGroups[psetName] ?? true}
                onToggle={() => {
                  setOpenGroups((o) => ({
                    ...o,
                    [psetName]: !(o[psetName] ?? true),
                  }));
                }}
                filter={filter || undefined}
                selectedKey={selectedKey}
                onSelectKey={setSelectedKey}
              />
            ))}
            {/* Bottom border to close last group */}
            <div style={{ borderTop: '1px solid var(--border)' }} />
            {filter && shown === 0 && (
              <div
                className="py-6 text-center"
                style={{
                  fontSize: 11.5,
                  color: 'var(--fg-3)',
                  fontFamily: 'var(--mono)',
                }}
              >
                No properties match &ldquo;{filter}&rdquo;
              </div>
            )}
          </>
        )}
      </div>

      {/* Pinned key footer */}
      {selectedKey && (
        <div
          className="flex items-center justify-between border-t border-border"
          style={{
            padding: '10px 14px',
            background: 'var(--surface-low)',
            fontSize: 12,
            color: 'var(--fg-3)',
            fontFamily: 'var(--mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span className="truncate">
            <span style={{ color: 'var(--fg-2)', fontWeight: 700 }}>
              Pinned:
            </span>{' '}
            {selectedKey}
          </span>
          <button
            type="button"
            onClick={() => { setSelectedKey(null); }}
            className="cursor-pointer border-none bg-transparent"
            style={{
              color: 'var(--primary)',
              fontFamily: 'inherit',
              fontSize: 12,
              marginLeft: 8,
            }}
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}
