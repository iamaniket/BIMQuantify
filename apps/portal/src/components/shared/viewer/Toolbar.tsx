'use client';

import {
  Axis3D,
  Box,
  Glasses,
  Home,
  MousePointer2,
  Settings,
  User,
} from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { type ToolGroup, UnifiedToolbar } from './UnifiedToolbar';
import { SettingsDialog } from './settings/SettingsDialog';

type Props = {
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
};

export function Toolbar({
  handle,
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
          type: 'button', id: 'home', icon: Home, label: 'Home view',
          onClick: () => { run('camera.home'); },
        },
        {
          type: 'button',
          id: 'select',
          icon: MousePointer2,
          label: 'Select',
          isActive: activeTool === 'select',
          onClick: () => { setActiveTool('select'); },
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
