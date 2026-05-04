'use client';

import { X } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import {
  Panel,
  PanelBody,
  PanelHeader,
  cn,
} from '@bimstitch/ui';

export type ViewerPanelId = 'properties' | 'explorer';

export type OpenPanels = Record<ViewerPanelId, boolean>;

type ViewerSidePanelProps = {
  openPanels: OpenPanels;
  onClosePanel: (id: ViewerPanelId) => void;
  explorerContent: ReactNode;
  propertiesContent: ReactNode;
};

const PANEL_TITLES: Record<ViewerPanelId, string> = {
  properties: 'Properties',
  explorer: 'Model Explorer',
};

function SinglePanel({
  id,
  onClose,
  children,
}: {
  id: ViewerPanelId;
  onClose: (id: ViewerPanelId) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Panel className="flex h-full min-h-0 flex-col rounded-none">
      <PanelHeader className="flex shrink-0 items-center justify-between">
        <span className="text-body2 font-medium text-foreground">
          {PANEL_TITLES[id]}
        </span>
        <button
          type="button"
          onClick={() => onClose(id)}
          aria-label={`Close ${PANEL_TITLES[id]}`}
          className="-mr-1 rounded p-1 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </PanelHeader>
      <PanelBody className="flex-1 overflow-auto p-0">
        {children}
      </PanelBody>
    </Panel>
  );
}

export function ViewerSidePanel({
  openPanels,
  onClosePanel,
  explorerContent,
  propertiesContent,
}: ViewerSidePanelProps): JSX.Element {
  const anyOpen = openPanels.explorer || openPanels.properties;

  return (
    <div
      aria-hidden={!anyOpen}
      className={cn(
        'absolute bottom-4 right-0 top-0 z-20 w-80 transition-transform duration-200 ease-out',
        anyOpen
          ? 'translate-x-0 pointer-events-auto'
          : 'translate-x-full pointer-events-none',
      )}
    >
      <div className="flex h-full flex-col gap-2 pr-8">
        <div className="min-h-0 flex-1">
          {openPanels.explorer && (
            <SinglePanel id="explorer" onClose={onClosePanel}>
              {explorerContent}
            </SinglePanel>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {openPanels.properties && (
            <SinglePanel id="properties" onClose={onClosePanel}>
              {propertiesContent}
            </SinglePanel>
          )}
        </div>
      </div>
    </div>
  );
}
