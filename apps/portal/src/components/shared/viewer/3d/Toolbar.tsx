'use client';

import { Camera, Eraser, Home, MousePointer2, Orbit, Settings } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { type ToolGroup, UnifiedToolbar } from '@/components/shared/viewer/shared/UnifiedToolbar';
import { SettingsDialog } from '@/components/shared/viewer/shared/settings/SettingsDialog';

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
      setActiveTool(active ? 'eraser' : 'select');
    });
    const offNavigate = handle.events.on('navigate:change', ({ active }) => {
      setActiveTool(active ? 'navigate' : 'select');
    });
    return () => { offEraser(); offNavigate(); };
  }, [handle]);

  // Key 2 = select: exit any active mode and return to default
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const target = ev.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (ev.key !== '2') return;
      ev.preventDefault();
      if (!handle) return;
      handle.commands.execute('eraser.exit').catch(() => undefined);
      handle.commands.execute('navigate.exit').catch(() => undefined);
      setActiveTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
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
          tooltip: `${t('homeView')} (1)`,
          onClick: () => { run('camera.home'); },
        },
        {
          type: 'button',
          id: 'select',
          icon: MousePointer2,
          label: t('select'),
          tooltip: `${t('select')} (2)`,
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
          tooltip: `${t('navigate')} (3)`,
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
          tooltip: `${t('eraser')} (4)`,
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
          tooltip: `${t('screenshot')} (5)`,
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
