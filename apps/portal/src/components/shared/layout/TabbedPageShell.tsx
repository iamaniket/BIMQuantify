'use client';

import type { ReactNode } from 'react';

import {
  cn,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@bimdossier/ui';

import { PanelHeading } from '@/components/shared/PanelHeading';
import { TAB_TRIGGER_CLASS } from '@/components/shared/tabStyles';

import { PageShell } from './PageShell';

export type TabDef = {
  value: string;
  label: string;
  icon: ReactNode;
  badge?: ReactNode;
};

type Props = {
  hero: ReactNode;
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  panelHeading: { eyebrow: string; title: string; sub?: string };
  /** Rendered between panel heading and scrollable content (e.g. per-tab toolbars). */
  toolbar?: ReactNode;
  /** Rendered after the Tabs (e.g. dialogs). */
  afterTabs?: ReactNode;
  /**
   * When true the content area becomes a non-scrolling, padding-free flex column
   * so a child (e.g. `DataTable` + pinned `TablePaginationFooter`) can own the
   * scroll and fill the full height. Compute it per active tab — `true` for a
   * full-height table tab, `false` (default) for padded, page-scrolling content.
   */
  fillContent?: boolean;
  /** TabsContent blocks. */
  children: ReactNode;
};

export function TabbedPageShell({
  hero,
  tabs,
  activeTab,
  onTabChange,
  panelHeading,
  toolbar,
  afterTabs,
  fillContent = false,
  children,
}: Props): ReactNode {
  return (
    <PageShell hero={hero}>
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TabsList className="shrink-0 gap-1 rounded-none border-b border-border bg-surface-main p-0 px-5">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className={TAB_TRIGGER_CLASS}>
              {tab.icon}
              {tab.label}
              {tab.badge}
            </TabsTrigger>
          ))}
        </TabsList>

        <PanelHeading
          eyebrow={panelHeading.eyebrow}
          title={panelHeading.title}
          sub={panelHeading.sub}
        />

        {toolbar}

        <div
          className={cn(
            'min-h-0 flex-1',
            fillContent ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-5',
          )}
        >
          {children}
        </div>
      </Tabs>

      {afterTabs}
    </PageShell>
  );
}
