'use client';

import {
  Axis3D,
  Box,
  Glasses,
  Grip,
  Home,
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

import { cn } from '@bimstitch/ui';
import type { ViewerHandle } from '@bimstitch/viewer';

import type { ViewerSettings } from '@/lib/viewerSettings';

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
    { id: 'home', icon: Home, label: 'Home view', command: 'camera.home' },
  ],
  [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'pan', icon: Move, label: 'Pan' },
    { id: 'orbit', icon: Orbit, label: 'Orbit' },
    { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
    { id: 'fit', icon: Maximize, label: 'Fit to view', command: 'camera.zoomExtents' },
  ],
  [
    { id: 'section', icon: Scan, label: 'Section', command: 'section.add' },
    { id: 'markup', icon: Pencil, label: 'Markup', disabled: true },
  ],
  [
    { id: 'wireframe', icon: Axis3D, label: 'Wireframe', command: 'wireframe.toggle' },
    { id: 'xray', icon: Glasses, label: 'X-Ray', command: 'xray.toggleAll' },
    { id: 'isolate', icon: Box, label: 'Isolate', command: 'isolation.toggle' },
    { id: 'explode', icon: Grip, label: 'Explode', disabled: true },
    { id: 'walkthrough', icon: User, label: 'First person', command: 'walkthrough.toggle' },
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
    <div
      className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2"
      data-testid="viewer-toolbar"
    >
      {settingsOpen ? (
        <ViewerSettingsPopover
          handle={handle}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onClose={() => setSettingsOpen(false)}
          onReloadViewer={() => {
            setSettingsOpen(false);
            onReloadViewer();
          }}
        />
      ) : null}

      <div className="flex items-center rounded-xl border border-border bg-white/95 px-1 py-0.5 shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl backdrop-saturate-150 dark:border-white/[0.08] dark:bg-[rgba(15,15,20,0.75)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]">
        {GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center">
            {gi > 0 && (
              <div className="mx-0.5 h-4 w-px rounded-full bg-black/[0.08] dark:bg-white/[0.07]" />
            )}
            <div className="flex items-center gap-0.5 px-0.5 py-0.5">
              {group.map((def) => {
                const Icon = def.id === 'theme' ? (isDark ? Moon : Sun) : def.icon;
                const isActive = def.id === activeTool || (def.id === 'settings' && settingsOpen);
                return (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => handleClick(def)}
                    title={def.disabled ? `${def.label} (coming soon)` : def.label}
                    aria-label={def.label}
                    disabled={def.disabled}
                    data-testid={`viewer-tool-${def.id}`}
                    className={cn(
                      'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ease-out',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
                      def.disabled
                        ? 'cursor-not-allowed text-foreground/20'
                        : isActive
                          ? 'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(59,130,246,0.25),inset_0_1px_0_rgba(255,255,255,0.15)]'
                          : 'text-foreground/55 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.94]',
                    )}
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
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
