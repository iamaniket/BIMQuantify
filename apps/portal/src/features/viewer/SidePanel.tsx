'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '@bimstitch/ui';

import { DocumentsPanel } from './documents/DocumentsPanel';
import type { PanelId } from '@/components/shared/viewer/SideRail';

export type { PanelId } from '@/components/shared/viewer/SideRail';

const PANEL_TITLES: Record<PanelId, string> = {
  explorer: 'Model Tree',
  properties: 'Properties',
  documents: 'Documents',
  issues: 'Issues',
  compliance: 'BBL Compliance',
  measure: 'Measurement',
  section: 'Section Planes',
  bcf: 'BCF Topics',
  pages: 'Pages',
};

type SidePanelProps = {
  activePanel: PanelId | null;
  explorerContent?: ReactNode | undefined;
  propertiesContent?: ReactNode | undefined;
  measureContent?: ReactNode | undefined;
  sectionContent?: ReactNode | undefined;
  bcfContent?: ReactNode | undefined;
  pagesContent?: ReactNode | undefined;
  headerActions?: Partial<Record<PanelId, ReactNode>> | undefined;
};

function PlaceholderContent({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <p className="text-body2 font-medium text-foreground-secondary">{label}</p>
        <p className="mt-1 font-mono text-caption text-foreground-secondary/60">
          Coming soon
        </p>
      </div>
    </div>
  );
}

export function SidePanel({
  activePanel,
  explorerContent,
  propertiesContent,
  measureContent,
  sectionContent,
  bcfContent,
  pagesContent,
  headerActions,
}: SidePanelProps): JSX.Element {
  const isOpen = activePanel !== null;

  return (
    <div
      aria-hidden={!isOpen}
      className={cn(
        'absolute bottom-0 right-[51px] top-0 z-20 w-[360px] transition-transform duration-200 ease-out',
        isOpen
          ? 'pointer-events-auto translate-x-0'
          : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex h-full flex-col border-l border-border bg-background shadow-lg">
        {activePanel !== null && (
          <>
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-background-secondary px-3.5">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground-secondary">
                {PANEL_TITLES[activePanel]}
              </span>
              {headerActions?.[activePanel] && (
                <div className="flex items-center gap-0.5">
                  {headerActions[activePanel]}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {activePanel === 'explorer' && explorerContent}
              {activePanel === 'properties' && propertiesContent}
              {activePanel === 'documents' && <DocumentsPanel />}
              {activePanel === 'measure' && measureContent}
              {activePanel === 'section' && sectionContent}
              {activePanel === 'bcf' && bcfContent}
              {activePanel === 'pages' && pagesContent}
              {activePanel === 'issues' && <PlaceholderContent label="Issues" />}
              {activePanel === 'compliance' && <PlaceholderContent label="BBL Compliance" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
