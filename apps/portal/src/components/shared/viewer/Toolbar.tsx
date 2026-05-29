'use client';

import {
  Axis3D,
  Box,
  Camera,
  Eraser,
  Expand,
  Glasses,
  Home,
  MousePointer2,
  Palette,
  Settings,
  User,
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
  const [colorCodingActive, setColorCodingActive] = useState(false);
  const [exploded, setExploded] = useState(false);

  useEffect(() => {
    if (!handle) return;
    const offMode = handle.events.on('mode:exit', ({ toolName }) => {
      if (toolName.startsWith('walkthrough')) {
        setActiveTool('select');
      }
    });
    const offEraser = handle.events.on('eraser:change', ({ active }) => {
      if (!active) setActiveTool('select');
    });
    const offColorCoding = handle.events.on('colorCoding:change', ({ active }) => {
      setColorCodingActive(active);
    });
    const offExploder = handle.events.on('exploder:change', ({ active }) => {
      setExploded(active);
    });
    return () => { offMode(); offEraser(); offColorCoding(); offExploder(); };
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
            if (activeTool === 'walkthrough') run('walkthrough.exit');
            setActiveTool('select');
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
              if (activeTool === 'walkthrough') run('walkthrough.exit');
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
          type: 'button', id: 'wireframe', icon: Axis3D, label: t('wireframe'),
          onClick: () => { run('wireframe.toggle'); },
        },
        {
          type: 'button', id: 'xray', icon: Glasses, label: t('xray'),
          onClick: () => { run('xray.toggleAll'); },
        },
        {
          type: 'button', id: 'isolate', icon: Box, label: t('isolate'),
          onClick: () => { run('isolation.toggle'); },
        },
        {
          type: 'button', id: 'walkthrough', icon: User, label: t('firstPerson'),
          isActive: activeTool === 'walkthrough',
          onClick: () => {
            if (activeTool === 'walkthrough') {
              run('walkthrough.exit');
              setActiveTool('select');
            } else {
              if (activeTool === 'eraser') run('eraser.exit');
              run('walkthrough.enter');
              setActiveTool('walkthrough');
            }
          },
        },
        {
          type: 'button', id: 'colorCoding', icon: Palette, label: t('colorCoding'),
          isActive: colorCodingActive,
          onClick: () => { run('colorCoding.toggle'); },
        },
        {
          type: 'button', id: 'explode', icon: Expand, label: t('explode'),
          isActive: exploded,
          onClick: () => { run('exploder.toggle'); },
        },
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
