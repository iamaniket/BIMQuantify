'use client';

import { Box } from 'lucide-react';
import { type JSX } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@bimstitch/ui';

import type { ModelMetadata } from '@/lib/api/viewerTypes';

import { PanelEmptyState } from '../PanelEmptyState';
import { ClassesTab } from './ClassesTab';
import { ObjectsTab } from './ObjectsTab';
import { StoriesTab } from './StoriesTab';

type ModelExplorerProps = {
  metadata: ModelMetadata | undefined;
  isLoading: boolean;
};

export function ModelExplorer({
  metadata,
  isLoading,
}: ModelExplorerProps): JSX.Element {
  if (isLoading) {
    return <PanelEmptyState message="Loading model data..." />;
  }

  if (!metadata) {
    return (
      <PanelEmptyState
        icon={Box}
        message="No metadata available for this model."
      />
    );
  }

  return (
    <Tabs defaultValue="objects" className="flex h-full flex-col">
      <TabsList className="mx-2 mt-2 shrink-0">
        <TabsTrigger value="objects" className="flex-1">
          Objects
        </TabsTrigger>
        <TabsTrigger value="classes" className="flex-1">
          Classes
        </TabsTrigger>
        <TabsTrigger value="stories" className="flex-1">
          Stories
        </TabsTrigger>
      </TabsList>

      <TabsContent value="objects" className="min-h-0 flex-1 overflow-auto">
        <ObjectsTab
          spatialTree={metadata.spatialTree}
          elements={metadata.elements}
        />
      </TabsContent>

      <TabsContent value="classes" className="min-h-0 flex-1 overflow-auto">
        <ClassesTab elements={metadata.elements} />
      </TabsContent>

      <TabsContent value="stories" className="min-h-0 flex-1 overflow-auto">
        <StoriesTab
          spatialTree={metadata.spatialTree}
          elements={metadata.elements}
        />
      </TabsContent>
    </Tabs>
  );
}
