'use client';

import {
  useCallback, useEffect, useMemo, useState, type JSX,
} from 'react';

import {
  Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@bimstitch/ui';
import type { ViewerHandle } from '@bimstitch/viewer';

import {
  DOCUMENT_ACTION_LABELS,
  type DocumentAction,
  type DocumentSettings,
} from '@/lib/documentSettings';
import type { CameraAction, ViewerSettings } from '@/lib/viewerSettings';

import { classifyCommand } from './shortcutCategories';
import { MouseDiagram } from './MouseDiagram';
import { ShortcutList } from './ShortcutList';
import { VisualKeyboard } from './VisualKeyboard';
import type { NormalizedBinding } from './types';

type Binding3D = { combo: string; command: string };

type Props3D = {
  mode: '3d';
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
};

type Props2D = {
  mode: '2d';
  handle: undefined;
  settings: DocumentSettings;
  onSettingsChange: (next: DocumentSettings) => void;
};

type Props = Props3D | Props2D;

const CAMERA_ACTIONS: { value: CameraAction; label: string }[] = [
  { value: 'rotate', label: 'Rotate (orbit)' },
  { value: 'truck', label: 'Truck (pan)' },
  { value: 'dolly', label: 'Dolly (zoom)' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'offset', label: 'Offset' },
  { value: 'none', label: 'None' },
];

const DRAG_BUTTONS: { key: 'left' | 'middle' | 'right' | 'wheel'; label: string }[] = [
  { key: 'left', label: 'Left button' },
  { key: 'middle', label: 'Middle button' },
  { key: 'right', label: 'Right button' },
  { key: 'wheel', label: 'Wheel' },
];

const ACTION_ORDER: DocumentAction[] = [
  'zoomIn', 'zoomOut', 'fitPage', 'fitWidth', 'actualSize',
  'rotateRight', 'rotateLeft',
  'nextPage', 'prevPage', 'firstPage', 'lastPage',
  'toolSelect', 'toolPan', 'toolZoom',
];

function comboFromEvent(ev: KeyboardEvent): string {
  const ordered: string[] = [];
  if (ev.ctrlKey) ordered.push('Ctrl');
  if (ev.altKey) ordered.push('Alt');
  if (ev.shiftKey) ordered.push('Shift');
  if (ev.metaKey) ordered.push('Meta');
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key)) return '';
  const { code } = ev;
  if (code.startsWith('Key') && code.length === 4) {
    ordered.push(code.slice(3));
    return ordered.join('+');
  }
  if (code.startsWith('Numpad')) {
    ordered.push(code);
    return ordered.join('+');
  }
  let { key } = ev;
  if (key === ' ') key = 'Space';
  if (key === '+' || key === '=') key = '+';
  if (key.length === 1) key = key.toUpperCase();
  ordered.push(key);
  return ordered.join('+');
}

function use3DBindings(handle: ViewerHandle | null): {
  bindings: NormalizedBinding[];
  refresh: () => void;
} {
  const [raw, setRaw] = useState<Binding3D[]>([]);

  const refresh = useCallback(() => {
    if (!handle) return;
    handle.commands
      .execute<Binding3D[]>('shortcuts.list')
      .then(setRaw)
      .catch(() => undefined);
  }, [handle]);

  useEffect(() => { refresh(); }, [refresh]);

  const bindings = useMemo(() => {
    const metaMap = new Map<string, { title: string | undefined }>();
    if (handle) {
      for (const entry of handle.commands.list()) {
        const m = entry.meta as
          { title: string | undefined } | undefined;
        metaMap.set(entry.name, m ?? { title: undefined });
      }
    }
    return raw.map((b): NormalizedBinding => {
      const meta = metaMap.get(b.command);
      const title = meta !== undefined ? meta.title : undefined;
      return {
        command: b.command,
        label: title ?? b.command,
        combo: b.combo,
        category: classifyCommand(b.command),
      };
    });
  }, [raw, handle]);

  return { bindings, refresh };
}

function use2DBindings(settings: DocumentSettings): NormalizedBinding[] {
  return useMemo(
    () => ACTION_ORDER.map((action): NormalizedBinding => ({
      command: action,
      label: DOCUMENT_ACTION_LABELS[action],
      combo: settings.shortcuts[action] ?? '',
      category: classifyCommand(action),
    })),
    [settings],
  );
}

function Mouse3DSection({
  settings,
  onSettingsChange,
}: {
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
}): JSX.Element {
  const dragLabel = (action: CameraAction): string => {
    const found = CAMERA_ACTIONS.find(
      (a) => a.value === action,
    );
    return found !== undefined ? found.label : action;
  };

  return (
    <>
      <MouseDiagram
        leftButton={{
          label: 'Select',
          sublabel: `Drag: ${dragLabel(settings.controls.left)}`,
        }}
        middleButton={{
          label: 'Zoom',
          sublabel: `Drag: ${dragLabel(settings.controls.middle)}`,
        }}
        rightButton={{
          label: 'Pan',
          sublabel: `Drag: ${dragLabel(settings.controls.right)}`,
        }}
        scrollWheel={
          `Zoom in/out (${dragLabel(settings.controls.wheel)})`
        }
      />
      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          Drag actions
        </h4>
        {DRAG_BUTTONS.map((btn) => (
          <label
            key={btn.key}
            className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary"
          >
            <span>{btn.label}</span>
            <Select
              selectSize="sm"
              className="w-40"
              value={settings.controls[btn.key]}
              onChange={(e) => {
                onSettingsChange({
                  ...settings,
                  controls: {
                    ...settings.controls,
                    [btn.key]: e.target.value as CameraAction,
                  },
                });
              }}
            >
              {CAMERA_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
    </>
  );
}

function Mouse2DSection(): JSX.Element {
  const rows: { gesture: string; action: string }[] = [
    { gesture: 'Ctrl + Wheel', action: 'Zoom in / out toward cursor' },
    { gesture: 'Middle drag', action: 'Pan' },
    { gesture: 'Left drag (Pan tool)', action: 'Pan' },
    { gesture: 'Left click (Zoom tool)', action: 'Zoom in toward cursor' },
    { gesture: 'Alt + left click (Zoom)', action: 'Zoom out toward cursor' },
    { gesture: 'Double-click (Pan/Zoom)', action: 'Fit to page' },
  ];

  return (
    <>
      <MouseDiagram
        leftButton={{ label: 'Select', sublabel: undefined }}
        middleButton={{ label: 'Zoom', sublabel: 'Zoom In/Out' }}
        rightButton={{ label: 'Pan', sublabel: undefined }}
        scrollWheel="Zoom in/out (always available)"
      />
      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          Mouse gestures
        </h4>
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li
              key={r.gesture}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 text-body3"
            >
              <span className="font-mono text-foreground-secondary">
                {r.gesture}
              </span>
              <span className="text-foreground">{r.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export function KeyBindingsTab(props: Props): JSX.Element {
  const { mode, settings, onSettingsChange } = props;
  const handle = mode === '3d' ? props.handle : null;

  const { bindings: bindings3D, refresh: refresh3D } = use3DBindings(
    mode === '3d' ? handle : null,
  );
  const bindings2D = use2DBindings(
    mode === '2d' ? (settings) : { shortcuts: {}, mouseBindings: {}, pageBackground: '' },
  );

  const bindings = mode === '3d' ? bindings3D : bindings2D;
  const [capturing, setCapturing] = useState<string | null>(null);

  const handleCaptureStart = useCallback((command: string) => {
    setCapturing(command);
  }, []);

  useEffect(() => {
    if (capturing === null) return undefined;
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const combo = comboFromEvent(ev);
      if (combo === '' || combo === 'Escape') {
        setCapturing(null);
        return;
      }

      if (mode === '3d' && handle) {
        const existing = bindings3D.find((b) => b.command === capturing);
        if (existing) {
          handle.commands.execute('shortcuts.unbind', { combo: existing.combo }).catch(() => undefined);
        }
        handle.commands
          .execute('shortcuts.bind', { combo, command: capturing })
          .then(() => {
            refresh3D();
            const s = settings;
            (onSettingsChange)({
              ...s,
              shortcuts: { ...s.shortcuts, [capturing]: combo },
            });
          })
          .catch(() => undefined);
      } else if (mode === '2d') {
        const s = settings;
        (onSettingsChange)({
          ...s,
          shortcuts: { ...s.shortcuts, [capturing]: combo },
        });
      }

      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); };
  }, [capturing, mode, handle, bindings3D, settings, onSettingsChange, refresh3D]);

  return (
    <Tabs defaultValue="keyboard">
      <TabsList className="shrink-0">
        <TabsTrigger value="keyboard" className="flex-1 text-caption">
          Keyboard
        </TabsTrigger>
        <TabsTrigger value="mouse" className="flex-1 text-caption">
          Mouse
        </TabsTrigger>
      </TabsList>

      <TabsContent value="keyboard" className="max-h-[28rem] overflow-y-auto">
        <div className="space-y-4 pt-3">
          <VisualKeyboard
            bindings={bindings}
            capturing={capturing}
            onCaptureStart={handleCaptureStart}
          />
          <ShortcutList
            bindings={bindings}
            capturing={capturing}
            onCaptureStart={handleCaptureStart}
          />
        </div>
      </TabsContent>

      <TabsContent value="mouse" className="max-h-[28rem] overflow-y-auto">
        <div className="space-y-4 pt-3">
          {mode === '3d' ? (
            <Mouse3DSection
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
          ) : (
            <Mouse2DSection />
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
