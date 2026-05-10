'use client';

import {
  Axis3D,
  Box,
  Glasses,
  Grip,
  Maximize,
  Moon,
  MousePointer2,
  Move,
  Orbit,
  Pencil,

  Scan,
  Settings,
  Sun,
  User,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState, type JSX } from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

import { ToolButton, ToolbarGroup, ToolbarShell } from './_toolbarPrimitives';
import { ViewerSettingsPopover } from './ViewerSettingsPopover';

type Props = {
  handle: ViewerHandle | null;
  selectionCount: number;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
};

type ToolButtonDef = {
  id: string;
  icon: LucideIcon;
  label: string;
  command?: string;
  disabled?: boolean;
};

const GROUPS: ToolButtonDef[][] = [
  [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'pan', icon: Move, label: 'Pan' },
    { id: 'orbit', icon: Orbit, label: 'Orbit' },
    { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
    {
      id: 'fit', icon: Maximize, label: 'Fit to view', command: 'camera.zoomExtents',
    },
  ],
  [
    {
      id: 'section', icon: Scan, label: 'Section', command: 'section.add',
    },
    {
      id: 'markup', icon: Pencil, label: 'Markup', disabled: true,
    },
  ],
  [
    {
      id: 'wireframe', icon: Axis3D, label: 'Wireframe', command: 'wireframe.toggle',
    },
    {
      id: 'xray', icon: Glasses, label: 'X-Ray', command: 'xray.toggleAll',
    },
    {
      id: 'isolate', icon: Box, label: 'Isolate', command: 'isolation.toggle',
    },
    {
      id: 'explode', icon: Grip, label: 'Explode', disabled: true,
    },
    {
      id: 'walkthrough', icon: User, label: 'First person', command: 'walkthrough.toggle',
    },
  ],
  [
    { id: 'settings', icon: Settings, label: 'Settings' },
    { id: 'theme', icon: Moon, label: 'Toggle theme' },
  ],
];

export function ViewerToolbar({
  handle,
  selectionCount,
  settings,
  onSettingsChange,
  onReloadViewer,
}: Props): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTool, setActiveTool] = useState('select');
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const run = (cmd: string, args?: unknown): void => {
    if (!handle) return;
    handle.commands.execute(cmd, args).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[viewer-toolbar] ${cmd} failed:`, err);
    });
  };

  const handleClick = (def: ToolButtonDef): void => {
    if (def.disabled) return;
    if (def.id === 'settings') {
      setSettingsOpen((v) => !v);
      return;
    }

    if (def.id === 'theme') {
      setTheme(isDark ? 'light' : 'dark');
      return;
    }

    // Walkthrough is modal — toggle between active and inactive
    if (def.id === 'walkthrough') {
      if (activeTool === 'walkthrough') {
        run('walkthrough.exit');
        setActiveTool('select');
      } else {
        run('walkthrough.enter');
        setActiveTool('walkthrough');
      }
      return;
    }

    if (def.command) {
      run(def.command);
    }
    if (!def.command || def.id === 'select' || def.id === 'pan' || def.id === 'orbit') {
      setActiveTool(def.id);
    }
  };

  return (
    <ToolbarShell testId="viewer-toolbar">
      {settingsOpen ? (
        <ViewerSettingsPopover
          handle={handle}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onClose={() => { setSettingsOpen(false); }}
          onReloadViewer={() => {
            setSettingsOpen(false);
            onReloadViewer();
          }}
        />
      ) : null}

      {GROUPS.map((group, gi) => (
        <ToolbarGroup key={gi} withDivider={gi > 0}>
          {group.map((def) => {
            const Icon = def.id === 'theme' ? (isDark ? Moon : Sun) : def.icon;
            const isActive = def.id === activeTool || (def.id === 'settings' && settingsOpen);
            return (
              <ToolButton
                key={def.id}
                onClick={() => { handleClick(def); }}
                title={def.disabled ? `${def.label} (coming soon)` : def.label}
                aria-label={def.label}
                disabled={def.disabled}
                isActive={isActive}
                data-testid={`viewer-tool-${def.id}`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {def.id === 'select' && selectionCount > 0 && (
                  <span
                    data-testid="viewer-selection-badge"
                    className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-caption font-bold leading-[16px] text-primary-foreground shadow-[0_2px_8px_rgba(59,130,246,0.4)]"
                  >
                    {selectionCount}
                  </span>
                )}
              </ToolButton>
            );
          })}
        </ToolbarGroup>
      ))}
    </ToolbarShell>
  );
}
