'use client';

import { FileText, Plus, Search } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Button, Input } from '@bimstitch/ui';

import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PanelEmptyState } from '@/components/shared/viewer/PanelEmptyState';
import { PanelTabs, type TabDef } from '@/components/shared/viewer/PanelTabs';

type DocsScope = 'all' | 'entity' | 'project';

export function DocumentsPanel(): JSX.Element {
  const partialCount = useViewerEntityStore((s) => s.selected.size);
  const selectedAll = useViewerEntityStore((s) => s.selectedAll);
  const hasSelection = selectedAll || partialCount > 0;
  const [scope, setScope] = useState<DocsScope>(hasSelection ? 'entity' : 'all');
  const [query, setQuery] = useState('');

  const tabs: TabDef<DocsScope>[] = [
    { id: 'all', label: 'All', count: 0 },
    { id: 'entity', label: 'On entity', count: 0, disabled: !hasSelection },
    { id: 'project', label: 'Project', count: 0 },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border bg-background px-3.5 py-3">
        <div className="min-w-0">
          <div className="font-mono text-caption font-bold uppercase tracking-[0.1em] text-foreground-secondary">
            {hasSelection ? 'Attached to selection' : 'Project library'}
          </div>
          <div className="mt-1 truncate text-body2 font-medium leading-tight text-foreground">
            {hasSelection ? 'Selected element' : 'All documents'}
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled
          title="Attach document (coming soon)"
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Attach
        </Button>
      </div>

      <PanelTabs tabs={tabs} active={scope} onChange={setScope} />

      <div className="border-b border-border bg-background px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            inputSize="sm"
            className="pl-7"
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
