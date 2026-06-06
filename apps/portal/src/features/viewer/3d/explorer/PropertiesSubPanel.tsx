'use client';

import { cn, CountChip } from '@bimstitch/ui';
import { Info } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useCallback, useRef, useState, type JSX,
} from 'react';

import { Eyebrow } from '@/components/shared/Eyebrow';
import { PanelEmptyState } from '@/components/shared/viewer/shared/PanelEmptyState';
import { ModelInfoBody } from '@/features/viewer/shared/inspector/ModelInfoBody';
import { MultiPropertiesBody } from '@/features/viewer/shared/inspector/MultiPropertiesBody';
import {
  PropertiesBody,
  countPsetProperties,
} from '@/features/viewer/shared/inspector/PropertiesBody';
import { useSelectedElement } from '@/features/viewer/shared/inspector/useSelectedElement';
import { useMultiSelectedProperties } from '@/features/viewer/shared/inspector/useMultiSelectedProperties';
import type { ModelMetadata, ModelProperties } from '@/lib/api/viewerTypes';

type PropertiesSubPanelProps = {
  metadata: ModelMetadata | undefined;
  properties: ModelProperties | undefined;
  isLoadingProperties: boolean;
  isLoadingMetadata?: boolean | undefined;
  expanded: boolean;
  onToggle: () => void;
};

export function PropertiesSubPanel({
  metadata,
  properties,
  isLoadingProperties,
  isLoadingMetadata,
  expanded,
  onToggle,
}: PropertiesSubPanelProps): JSX.Element {
  const t = useTranslations('viewer.explorer');
  const tInspector = useTranslations('viewerInspector');

  const {
    element,
    selectedAll,
    isMultiSelection,
    hasSelection,
  } = useSelectedElement(metadata);

  const isProjectMode = !hasSelection;

  const multiState = useMultiSelectedProperties(metadata, properties);

  let count: number | undefined;
  if (isProjectMode) {
    count = undefined;
  } else if (isMultiSelection) {
    count = multiState.commonCount;
  } else {
    count = countPsetProperties(element, properties);
  }

  const [flexGrow, setFlexGrow] = useState(1);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    const startY = e.clientY;
    const startFlex = flexGrow;
    const container = containerRef.current?.parentElement;
    const availableHeight = container ? container.clientHeight : 600;

    const onPointerMove = (ev: PointerEvent): void => {
      if (!dragging.current) return;
      const delta = startY - ev.clientY;
      const currentRatio = startFlex / (1 + startFlex);
      const newRatio = Math.max(0.2, Math.min(0.8, currentRatio + delta / availableHeight));
      setFlexGrow(newRatio / (1 - newRatio));
    };

    const onPointerUp = (): void => {
      dragging.current = false;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [flexGrow]);

  let body: JSX.Element | null = null;
  if (expanded) {
    if (selectedAll) {
      body = (
        <PanelEmptyState
          icon={Info}
          message={tInspector('messages.allSelected', {
            count: metadata?.totalElements ?? 0,
          })}
        />
      );
    } else if (isMultiSelection) {
      body = (
        <MultiPropertiesBody
          state={multiState}
          isLoading={isLoadingProperties}
        />
      );
    } else if (isProjectMode) {
      body = (
        <ModelInfoBody
          metadata={metadata}
          isLoading={isLoadingMetadata ?? false}
        />
      );
    } else if (element !== null) {
      body = (
        <PropertiesBody
          element={element}
          properties={properties}
          isLoading={isLoadingProperties}
        />
      );
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col border-t border-border',
        expanded ? 'min-h-0' : 'shrink-0',
      )}
      style={expanded ? { flex: flexGrow } : undefined}
    >
      {/* Resize handle — only when expanded */}
      {expanded && (
        <div
          onPointerDown={onPointerDown}
          className="h-[3px] shrink-0 cursor-row-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
        />
      )}

      {/* Toggle bar */}
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-full shrink-0 cursor-pointer select-none items-center gap-2 border-none pl-2 pr-3 text-left transition-colors hover:brightness-110"
        style={{
          background: 'linear-gradient(135deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)',
        }}
      >
        <span
          aria-hidden="true"
          className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center text-white/70 transition-transform duration-[120ms]"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2.5,1.5 5.5,4 2.5,6.5" />
          </svg>
        </span>

        <Eyebrow as="span" className="flex-1 truncate text-white">
          {t('propertiesTitle')}
        </Eyebrow>

        {count !== undefined && <CountChip>{count}</CountChip>}
      </button>

      {/* Content */}
      {expanded && body !== null && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {body}
        </div>
      )}
    </div>
  );
}
