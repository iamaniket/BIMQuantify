'use client';

import { FileText, Plus, Search } from 'lucide-react';
import { useState, type JSX } from 'react';

import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '../PanelEmptyState';
import { ViewerPanelTabs, type ViewerTabDef } from '../ViewerPanelTabs';

type DocsScope = 'all' | 'entity' | 'project';

export function DocumentsPanel(): JSX.Element {
  const selectionCount = useViewerEntityStore((s) => s.selected.size);
  const hasSelection = selectionCount > 0;
  const [scope, setScope] = useState<DocsScope>(hasSelection ? 'entity' : 'all');
  const [query, setQuery] = useState('');

  const tabs: ViewerTabDef<DocsScope>[] = [
    { id: 'all', label: 'All', count: 0 },
    { id: 'entity', label: 'On entity', count: 0, disabled: !hasSelection },
    { id: 'project', label: 'Project', count: 0 },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border bg-background px-3.5 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-foreground-secondary">
            {hasSelection ? 'Attached to selection' : 'Project library'}
          </div>
          <div className="mt-1 truncate text-[15px] font-medium leading-tight text-foreground">
            {hasSelection ? 'Selected element' : 'All documents'}
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Attach document (coming soon)"
          className="inline-flex h-7 shrink-0 cursor-not-allowed items-center gap-1 rounded-md bg-primary/40 px-2.5 text-[11.5px] font-semibold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Attach
        </button>
      </div>

      <ViewerPanelTabs tabs={tabs} active={scope} onChange={setScope} />

      <div className="border-b border-border bg-background px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[12px] text-foreground outline-none placeholder:text-foreground-secondary/60 focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <PanelEmptyState
          icon={FileText}
          message="No documents yet. Document attachments will appear here."
        />
      </div>
    </div>
  );
}
