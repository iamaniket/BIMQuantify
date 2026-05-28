'use client';

import {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PropertiesToolbar } from '@/features/viewer/properties/PropertiesToolbar';
import { PropertySetGroup } from '@/features/viewer/properties/PropertySetGroup';
import type { ElementEntry, ModelProperties } from '@/lib/api/viewerTypes';

type PropertiesBodyProps = {
  element: ElementEntry;
  properties: ModelProperties | undefined;
  isLoading: boolean;
};

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
        k.toLowerCase().includes(lower)
        || String(v ?? '').toLowerCase().includes(lower)
      ) {
        count += 1;
      }
    }
  }
  return count;
}

export function PropertiesBody({
  element,
  properties,
  isLoading,
}: PropertiesBodyProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const elementProps = element.globalId !== null && properties
    ? properties[element.globalId]
    : undefined;

  const psetEntries = useMemo(
    () => (elementProps
      ? Object.entries(elementProps).filter(
        ([key, value]) => key !== '_element_type'
              && typeof value === 'object'
              && value !== null,
      )
      : []),
    [elementProps],
  );

  const total = psetEntries.reduce(
    (s, [, pset]) => s + Object.keys(pset as Record<string, unknown>).length,
    0,
  );
  const shown = filter
    ? countFiltered(psetEntries, filter)
    : total;

  const allExpanded = psetEntries.length > 0
    && psetEntries.every(([name]) => openGroups[name] ?? true);

  const handleToggleExpand = useCallback(() => {
    if (allExpanded) {
      setOpenGroups({});
    } else {
      setOpenGroups(
        Object.fromEntries(psetEntries.map(([name]) => [name, true])),
      );
    }
  }, [allExpanded, psetEntries]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontFamily: 'var(--sans)' }}>
      <PropertiesToolbar
        query={filter}
        onQueryChange={setFilter}
        isAllExpanded={allExpanded}
        onToggleExpand={handleToggleExpand}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <PanelEmptyState message="Loading properties…" />
        ) : psetEntries.length === 0 ? (
          <PanelEmptyState message="No property sets found for this element." />
        ) : (
          <>
            {psetEntries.map(([psetName, pset]) => (
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

/** Counts pset properties for the selected element — used by the tab pill. */
export function countPsetProperties(
  element: ElementEntry | null,
  properties: ModelProperties | undefined,
): number {
  if (!element?.globalId || !properties) return 0;
  const elProps = properties[element.globalId];
  if (!elProps) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(elProps)) {
    if (key === '_element_type' || typeof value !== 'object' || value === null) continue;
    count += Object.keys(value).length;
  }
  return count;
}
