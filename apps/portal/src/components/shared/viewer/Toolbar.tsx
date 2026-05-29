'use client';

import {
  Camera,
  Eraser,
  Home,
  MousePointer2,
  Orbit,
  Settings,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('viewer.toolbar');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTool, setActiveTool] = useState('select');

  useEffect(() => {
    if (!handle) return;
    const offEraser = handle.events.on('eraser:change', ({ active }) => {
      if (!active) setActiveTool('select');
    });
    return () => { offEraser(); };
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
          type: 'button', id: 'home', icon: Home, label: t('homeView'),
          onClick: () => { run('camera.home'); },
        },
        {
          type: 'button',
          id: 'select',
          icon: MousePointer2,
          label: t('select'),
          isActive: activeTool === 'select',
          onClick: () => {
            if (activeTool === 'eraser') run('eraser.exit');
            if (activeTool === 'navigate') run('navigate.exit');
            setActiveTool('select');
          },
        },
        {
          type: 'button',
          id: 'navigate',
          icon: Orbit,
          label: t('navigate'),
          isActive: activeTool === 'navigate',
          onClick: () => {
            if (activeTool === 'eraser') run('eraser.exit');
            run('navigate.enter');
            setActiveTool('navigate');
          },
        },
        {
          type: 'button',
          id: 'eraser',
          icon: Eraser,
          label: t('eraser'),
          isActive: activeTool === 'eraser',
          onClick: () => {
            if (activeTool === 'eraser') {
              run('eraser.exit');
              setActiveTool('select');
            } else {
              if (activeTool === 'navigate') run('navigate.exit');
              run('eraser.enter');
              setActiveTool('eraser');
            }
          },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'screenshot', icon: Camera, label: t('screenshot'),
          onClick: () => { run('screenshot.download'); },
        },
      ],
    },
    {
      tools: [
        {
          type: 'button', id: 'settings', icon: Settings, label: t('settings'),
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
