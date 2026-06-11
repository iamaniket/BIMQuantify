'use client';

import { Box, Columns3, Eraser, Home, MousePointer2, Move, Orbit, Settings, Square } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

import type { ToolName, ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { type ToolGroup, UnifiedToolbar } from '@/components/shared/viewer/shared/UnifiedToolbar';
import { SettingsDialog } from '@/components/shared/viewer/shared/settings/SettingsDialog';
import { type ViewMode } from '@/components/shared/viewer/shared/ViewModeSwitcher';
import { CameraFlyPopover } from '@/components/shared/viewer/3d/CameraFlyPopover';

type Props = {
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  hasFloorPlans: boolean;
};

export function Toolbar({
  handle,
  settings,
  onSettingsChange,
  onReloadViewer,
  viewMode,
  onViewModeChange,
  hasFloorPlans,
}: Props): JSX.Element {
  const t = useTranslations('viewer.toolbar');
  const tVm = useTranslations('viewer.viewMode');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Single source of truth for the active pointer/camera tool — driven by the
  // tool-manager plugin's `tool:change` event. The four tools (select/navigate/
  // eraser/fly) are mutually exclusive; the manager guarantees exactly one.
  const [activeTool, setActiveTool] = useState<ToolName>('select');
  const flyOpen = activeTool === 'fly';

  useEffect(() => {
    if (!handle) return;
    return handle.events.on('tool:change', ({ tool }) => { setActiveTool(tool); });
  }, [handle]);

  const run = (cmd: string, args?: unknown): void => {
    if (!handle) return;
    handle.commands.execute(cmd, args).catch((err: unknown) => {
      console.warn(`[viewer-toolbar] ${cmd} failed:`, err);
    });
  };

  const setTool = (tool: ToolName): void => { run('tool.set', { tool }); };

  // Fly navigation only applies to the 3D camera — disable it (fall back to
  // select) when the user switches to the pure 2D plan, where the fly button is
  // hidden.
  useEffect(() => {
    if (viewMode === '2d' && flyOpen) setTool('select');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const navGroup: ToolGroup = {
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
        onClick: () => { setTool('select'); },
      },
      {
        type: 'button',
        id: 'navigate',
        icon: Orbit,
        label: t('navigate'),
        tooltip: `${t('navigate')} (3)`,
        isActive: activeTool === 'navigate',
        onClick: () => { setTool(activeTool === 'navigate' ? 'select' : 'navigate'); },
      },
      {
        type: 'button',
        id: 'eraser',
        icon: Eraser,
        label: t('eraser'),
        tooltip: `${t('eraser')} (4)`,
        isActive: activeTool === 'eraser',
        onClick: () => { setTool(activeTool === 'eraser' ? 'select' : 'eraser'); },
      },
      {
        type: 'button',
        id: 'fly',
        icon: Move,
        label: t('fly'),
        tooltip: t('flyTooltip'),
        isActive: flyOpen,
        onClick: () => { setTool(flyOpen ? 'select' : 'fly'); },
      },
    ],
  };

  const viewModeGroup: ToolGroup = {
    tools: [
      {
        type: 'button', id: 'view-3d', icon: Box, label: tVm('model'),
        tooltip: tVm('modelTooltip'), isActive: viewMode === '3d',
        onClick: () => { onViewModeChange('3d'); },
      },
      {
        type: 'button', id: 'view-split', icon: Columns3, label: tVm('split'),
        tooltip: tVm('splitTooltip'), isActive: viewMode === 'split',
        onClick: () => { onViewModeChange('split'); },
      },
      {
        type: 'button', id: 'view-2d', icon: Square, label: tVm('plan'),
        tooltip: tVm('planTooltip'), isActive: viewMode === '2d',
        onClick: () => { onViewModeChange('2d'); },
      },
    ],
  };

  const settingsGroup: ToolGroup = {
    tools: [
      {
        type: 'button', id: 'settings', icon: Settings, label: t('settings'),
        isActive: settingsOpen,
        onClick: () => { setSettingsOpen((v) => !v); },
      },
    ],
  };

  const groups: ToolGroup[] =
    viewMode === '2d'
      ? [...(hasFloorPlans ? [viewModeGroup] : []), settingsGroup]
      : [navGroup, ...(hasFloorPlans ? [viewModeGroup] : []), settingsGroup];

  return (
    <UnifiedToolbar groups={groups} testId="viewer-toolbar" testIdPrefix="viewer">
      {flyOpen ? (
        <CameraFlyPopover handle={handle} onClose={() => { setTool('select'); }} />
      ) : null}
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
