'use client';

import {
  Axis3D,
  Box,
  Glasses,
  Maximize,
  MousePointer2,
  Move,
  Orbit,
  Settings,
  User,
  ZoomIn,
} from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { type ToolGroup, UnifiedToolbar } from './UnifiedToolbar';
import { SettingsDialog } from './settings/SettingsDialog';

type Props = {
  handle: ViewerHandle | null;
  selectionCount: number;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
};

export function Toolbar({
  handle,
  selectionCount,
  settings,
  onSettingsChange,
  onReloadViewer,
}: Props): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTool, setActiveTool] = useState('select');

  useEffect(() => {
    if (!handle) return;
    return handle.events.on('mode:exit', ({ toolName }) => {
      if (toolName.startsWith('walkthrough')) {
        setActiveTool('select');
      }
    });
  }, [handle]);

  const run = (cmd: string): void => {
    if (!handle) return;
    handle.commands.execute(cmd).catch((err: unknown) => {
      console.warn(`[viewer-toolbar] ${cmd} failed:`, err);
    });
  };

  const groups: ToolGroup[] = [
    {
      tools: [
        {
          type: 'button',
          id: 'select',
          icon: MousePointer2,
          label: 'Select',
          isActive: activeTool === 'select',
          badge:
            selectionCount > 0 ? (
              <span
                data-testid="viewer-selection-badge"
                className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-caption font-bold leading-[16px] text-primary-foreground shadow-[0_2px_8px_rgba(59,130,246,0.4)]"
              >
                {selectionCount}
              </span>
            ) : undefined,
          onClick: () => { setActiveTool('select'); },
        },
        {
          type: 'button', id: 'pan', icon: Move, label: 'Pan',
          isActive: activeTool === 'pan',
          onClick: () => { setActiveTool('pan'); },
        },
        {
          type: 'button', id: 'orbit', icon: Orbit, label: 'Orbit',
          isActive: activeTool === 'orbit',
          onClick: () => { setActiveTool('orbit'); },
        },
        {
          type: 'button', id: 'zoom', icon: ZoomIn, label: 'Zoom',
          isActive: activeTool === 'zoom',
          onClick: () => { setActiveTool('zoom'); },
        },
        {
          type: 'button', id: 'fit', icon: Maximize, label: 'Fit to view',
          onClick: () => { run('camera.zoomExtents'); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'wireframe', icon: Axis3D, label: 'Wireframe',
          onClick: () => { run('wireframe.toggle'); },
        },
        {
          type: 'button', id: 'xray', icon: Glasses, label: 'X-Ray',
          onClick: () => { run('xray.toggleAll'); },
        },
        {
          type: 'button', id: 'isolate', icon: Box, label: 'Isolate',
          onClick: () => { run('isolation.toggle'); },
        },
        {
          type: 'button', id: 'walkthrough', icon: User, label: 'First person',
          isActive: activeTool === 'walkthrough',
          onClick: () => {
            if (activeTool === 'walkthrough') {
              run('walkthrough.exit');
              setActiveTool('select');
            } else {
              run('walkthrough.enter');
              setActiveTool('walkthrough');
            }
          },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'settings', icon: Settings, label: 'Settings',
          isActive: settingsOpen,
          onClick: () => { setSettingsOpen((v) => !v); },
        },
      ],
    },
  ];

  return (
    <UnifiedToolbar groups={groups} testId="viewer-toolbar" testIdPrefix="viewer">
      <SettingsDialog
        mode="3d"
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); }}
        handle={handle}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onReloadViewer={() => {
          setSettingsOpen(false);
          onReloadViewer();
        }}
      />
    </UnifiedToolbar>
  );
}
