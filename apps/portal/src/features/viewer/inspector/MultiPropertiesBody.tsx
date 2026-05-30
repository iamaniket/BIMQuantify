'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PropertiesToolbar } from '@/features/viewer/properties/PropertiesToolbar';
import { PropertySetGroup } from '@/features/viewer/properties/PropertySetGroup';
import { MultiElementHeader } from '@/features/viewer/properties/MultiElementHeader';
import type { MultiSelectedPropertiesState } from '@/features/viewer/inspector/useMultiSelectedProperties';

type MultiPropertiesBodyProps = {
  state: MultiSelectedPropertiesState;
  isLoading: boolean;
};

export function MultiPropertiesBody({
  state,
  isLoading,
}: MultiPropertiesBodyProps): JSX.Element {
  const t = useTranslations('viewer.properties');
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const psetEntries = useMemo(
    () => Object.entries(state.commonPsets),
    [state.commonPsets],
  );

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

  if (state.tooMany) {
    return (
      <PanelEmptyState
        icon={Info}
        message={t('tooManySelected', { count: state.selectedCount })}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <MultiElementHeader typeBreakdown={state.typeBreakdown} />

      <PropertiesToolbar
        query={filter}
        onQueryChange={setFilter}
        isAllExpanded={allExpanded}
        onToggleExpand={handleToggleExpand}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && (
          <PanelEmptyState message={t('loading')} />
        )}
        {!isLoading && psetEntries.length === 0 && (
          <PanelEmptyState message={t('noCommonProperties')} />
        )}
        {!isLoading && psetEntries.length > 0 && (
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
            <div className="border-t border-border" />
          </>
        )}
      </div>

      <div className="flex items-center border-t border-border bg-surface-low px-3.5 py-2.5 font-sans text-[13px] tabular-nums text-foreground-tertiary">
        <span>
          {t('multiSummary', {
            elements: state.selectedCount,
            properties: state.commonCount,
          })}
        </span>
      </div>
    </div>
  );
}
