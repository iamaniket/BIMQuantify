'use client';

import { useTranslations } from 'next-intl';
import {
  useCallback, useEffect, useMemo, useState, type JSX,
} from 'react';

import {
  Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@bimdossier/ui';
import type { ViewerHandle } from '@bimdossier/viewer';

import {
  controlsFrom3D,
  type DocumentAction,
  type DocumentCameraAction,
  type DocumentSettings,
} from '@/lib/documentSettings';
import type { CameraAction, ControlsSettings, ViewerSettings } from '@/lib/viewerSettings';

import { prettyKey } from './prettyKey';
import {
  CATEGORY_STYLES,
  classifyCommand,
} from './shortcutCategories';
import { KEYBOARD_ROWS, codeToComboKey } from './keyboardLayout';
import { MouseDiagram } from './MouseDiagram';
import { Toggle } from './primitives';
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
  controls3D: ControlsSettings;
  onSettingsChange: (next: DocumentSettings) => void;
};

type Props = Props3D | Props2D;

const CAMERA_ACTIONS: { value: CameraAction; labelKey: string }[] = [
  { value: 'rotate', labelKey: 'cameraRotate' },
  { value: 'truck', labelKey: 'cameraTruck' },
  { value: 'dolly', labelKey: 'cameraDolly' },
  { value: 'zoom', labelKey: 'cameraZoom' },
  { value: 'offset', labelKey: 'cameraOffset' },
  { value: 'none', labelKey: 'cameraNone' },
];

const CAMERA_ACTIONS_2D: { value: DocumentCameraAction; labelKey: string }[] = [
  { value: 'truck', labelKey: 'cameraTruck' },
  { value: 'zoom', labelKey: 'cameraZoom' },
  { value: 'none', labelKey: 'cameraNone' },
];

const DRAG_BUTTONS: { key: 'left' | 'middle' | 'right' | 'wheel'; labelKey: string }[] = [
  { key: 'left', labelKey: 'leftButton' },
  { key: 'middle', labelKey: 'middleButton' },
  { key: 'right', labelKey: 'rightButton' },
  { key: 'wheel', labelKey: 'wheel' },
];

// Command bound to the double-click gesture (isolate-or-fit). Surfaced in
// the Mouse tab as a single button picker.
const ISOLATE_AT_POINTER_CMD = 'visibility.isolateAtPointer';

const DOUBLE_CLICK_BUTTONS: { value: 'left' | 'middle' | 'right' | 'none'; labelKey: string }[] = [
  { value: 'left', labelKey: 'leftButton' },
  { value: 'middle', labelKey: 'middleButton' },
  { value: 'right', labelKey: 'rightButton' },
  { value: 'none', labelKey: 'mouseBindingNone' },
];

/** Read which button the double-click isolate gesture is bound to (or 'none'). */
function doubleClickButtonOf(mouseBindings: Record<string, string>): string {
  for (const [gesture, command] of Object.entries(mouseBindings)) {
    if (command !== ISOLATE_AT_POINTER_CMD) continue;
    if (!gesture.startsWith('doubleclick:')) continue;
    const btn = gesture.slice('doubleclick:'.length).split('+').pop()?.toLowerCase();
    if (btn === 'left' || btn === 'middle' || btn === 'right') return btn;
  }
  return 'none';
}

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

function use3DBindings(
  handle: ViewerHandle | null,
  draftShortcuts?: Record<string, string>,
): {
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
    const base = raw.map((b): NormalizedBinding => {
      const meta = metaMap.get(b.command);
      const title = meta !== undefined ? meta.title : undefined;
      return {
        command: b.command,
        label: title ?? b.command,
        combo: b.combo,
        category: classifyCommand(b.command),
      };
    });
    if (!draftShortcuts) return base;
    return base.map((b): NormalizedBinding => {
      const draftCombo = draftShortcuts[b.command];
      if (draftCombo !== undefined) return { ...b, combo: draftCombo };
      return b;
    });
  }, [raw, handle, draftShortcuts]);

  return { bindings, refresh };
}

function use2DBindings(
  settings: DocumentSettings,
  actionLabel: (action: DocumentAction) => string,
): NormalizedBinding[] {
  return useMemo(
    () => ACTION_ORDER.map((action): NormalizedBinding => ({
      command: action,
      label: actionLabel(action),
      combo: settings.shortcuts[action] ?? '',
      category: classifyCommand(action),
    })),
    [settings, actionLabel],
  );
}

// ── Inline helper components ────────────────────────────────────────

function CaptureOverlay({ action, combo, cat, onCancel }: {
  action: string;
  combo: string;
  cat: { swatch: string } | null;
  onCancel: () => void;
}): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [onCancel]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(15,23,42,0.55)' }}>
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-main p-6 text-center shadow-lg">
        <div className="text-caption font-bold uppercase tracking-widest text-primary">
          {t('listeningTitle')}
        </div>
        <div className="mt-2 text-lg font-medium text-foreground">
          {t.rich('pressAnyKeyFor', {
            action: (chunks) => (
              <span style={{ color: cat?.swatch ?? 'var(--primary)' }}>{chunks}</span>
            ),
            name: action,
          })}
        </div>
        <div className="mt-3 text-body3 text-foreground-tertiary">
          {t('currentlyBoundTo')}{' '}
          <kbd className="rounded border border-border bg-surface-high px-1.5 py-0.5 font-sans text-caption font-semibold text-foreground">
            {prettyKey(combo)}
          </kbd>
          {' '}· {t.rich('pressEscToCancel', {
            key: () => (
              <kbd className="rounded border border-border bg-surface-high px-1.5 py-0.5 font-sans text-caption font-semibold text-foreground">{'Esc'}</kbd>
            ),
          })}
        </div>
      </div>
    </div>
  );
}

// ── Mouse 3D Section (drag-action selects) ──────────────────────────

function Mouse3DDiagram({
  settings, selected, onPick,
}: {
  settings: ViewerSettings;
  selected: string | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  const ts = useTranslations('viewer.settings');
  const dragLabel = (action: CameraAction): string => {
    const found = CAMERA_ACTIONS.find((a) => a.value === action);
    return found !== undefined ? ts(found.labelKey) : action;
  };
  return (
    <MouseDiagram
      leftButton={{ label: t('selectLabel'), sublabel: t('dragSublabel', { action: dragLabel(settings.controls.left) }) }}
      middleButton={{ label: t('zoomLabel'), sublabel: t('dragSublabel', { action: dragLabel(settings.controls.middle) }) }}
      rightButton={{ label: t('panLabel'), sublabel: t('dragSublabel', { action: dragLabel(settings.controls.right) }) }}
      scrollWheel={t('zoomInOut', { action: dragLabel(settings.controls.wheel) })}
      selected={selected}
      onPick={onPick}
    />
  );
}

function Mouse3DSettings({
  settings, onSettingsChange,
}: {
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
}): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  const ts = useTranslations('viewer.settings');

  const doubleClickButton = doubleClickButtonOf(settings.mouseBindings);
  const setDoubleClickButton = (value: string): void => {
    const next: Record<string, string> = {};
    for (const [gesture, command] of Object.entries(settings.mouseBindings)) {
      if (command === ISOLATE_AT_POINTER_CMD && gesture.startsWith('doubleclick:')) continue;
      next[gesture] = command;
    }
    if (value !== 'none') next[`doubleclick:${value}`] = ISOLATE_AT_POINTER_CMD;
    onSettingsChange({ ...settings, mouseBindings: next });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          {t('dragActions')}
        </h4>
        {DRAG_BUTTONS.map((btn) => (
          <label key={btn.key} className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
            <span>{ts(btn.labelKey)}</span>
            <Select
              selectSize="md"
              className="w-40"
              value={settings.controls[btn.key]}
              onChange={(e) => {
                onSettingsChange({
                  ...settings,
                  controls: { ...settings.controls, [btn.key]: e.target.value as CameraAction },
                });
              }}
            >
              {CAMERA_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{ts(a.labelKey)}</option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          {ts('mouseActions')}
        </h4>
        <label className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
          <span>{ts('doubleClickIsolate')}</span>
          <Select
            selectSize="md"
            className="w-40"
            value={doubleClickButton}
            onChange={(e) => { setDoubleClickButton(e.target.value); }}
          >
            {DOUBLE_CLICK_BUTTONS.map((b) => (
              <option key={b.value} value={b.value}>{ts(b.labelKey)}</option>
            ))}
          </Select>
        </label>
      </div>
    </div>
  );
}

function Mouse2DDiagram({
  settings, controls3D, selected, onPick,
}: {
  settings: DocumentSettings;
  controls3D: ControlsSettings;
  selected: string | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  const ts = useTranslations('viewer.settings');
  const effective = settings.controlsLinked
    ? controlsFrom3D(controls3D)
    : settings.controls;
  const actionLabel = (action: DocumentCameraAction): string => {
    const found = CAMERA_ACTIONS_2D.find((a) => a.value === action);
    return found !== undefined ? ts(found.labelKey) : action;
  };
  const interactiveProps = settings.controlsLinked
    ? {}
    : { selected, onPick };
  return (
    <MouseDiagram
      leftButton={{ label: t('selectLabel'), sublabel: t('dragSublabel', { action: actionLabel(effective.left) }) }}
      middleButton={{ label: t('zoomLabel'), sublabel: t('dragSublabel', { action: actionLabel(effective.middle) }) }}
      rightButton={{ label: t('panLabel'), sublabel: t('dragSublabel', { action: actionLabel(effective.right) }) }}
      scrollWheel={t('zoomInOut', { action: actionLabel(effective.wheel) })}
      {...interactiveProps}
    />
  );
}

function Mouse2DSettings({
  settings, controls3D, onSettingsChange,
}: {
  settings: DocumentSettings;
  controls3D: ControlsSettings;
  onSettingsChange: (next: DocumentSettings) => void;
}): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  const ts = useTranslations('viewer.settings');
  const td = useTranslations('viewer.documentSettings');

  const linked = settings.controlsLinked;
  const effective = linked ? controlsFrom3D(controls3D) : settings.controls;

  const toggleLinked = (v: boolean): void => {
    if (v) {
      onSettingsChange({ ...settings, controlsLinked: true });
    } else {
      onSettingsChange({
        ...settings,
        controlsLinked: false,
        controls: controlsFrom3D(controls3D),
      });
    }
  };

  const gestures: { gesture: string; action: string }[] = [
    { gesture: td('gesture.ctrlWheel'), action: td('gesture.actionZoomCursor') },
    { gesture: td('gesture.middleDrag'), action: td('gesture.actionPan') },
    { gesture: td('gesture.leftDragPan'), action: td('gesture.actionPan') },
    { gesture: td('gesture.leftClickZoom'), action: td('gesture.actionZoomInCursor') },
    { gesture: td('gesture.altLeftClickZoom'), action: td('gesture.actionZoomOutCursor') },
    { gesture: td('gesture.doubleClick'), action: td('gesture.actionFitPage') },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Toggle
          label={td('controlsLinkedToggle')}
          checked={linked}
          onChange={toggleLinked}
        />
        {linked && (
          <p className="text-caption text-foreground-tertiary">
            {td('controlsLinkedNote')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          {t('dragActions')}
        </h4>
        {DRAG_BUTTONS.map((btn) => (
          <label key={btn.key} className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
            <span>{ts(btn.labelKey)}</span>
            <Select
              selectSize="md"
              className="w-40"
              disabled={linked}
              value={effective[btn.key]}
              onChange={(e) => {
                onSettingsChange({
                  ...settings,
                  controls: { ...settings.controls, [btn.key]: e.target.value as DocumentCameraAction },
                });
              }}
            >
              {CAMERA_ACTIONS_2D.map((a) => (
                <option key={a.value} value={a.value}>{ts(a.labelKey)}</option>
              ))}
            </Select>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          {t('mouseGestures')}
        </h4>
        <ul className="space-y-0.5">
          {gestures.map((r) => (
            <li key={r.gesture} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-body3">
              <span className="font-sans text-foreground-secondary">{r.gesture}</span>
              <span className="text-foreground">{r.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────

export function KeyBindingsTab(props: Props): JSX.Element {
  const t = useTranslations('viewer.shortcuts');
  const td = useTranslations('viewer.documentSettings');
  const { mode, settings, onSettingsChange } = props;
  const handle = mode === '3d' ? props.handle : null;

  const documentActionLabel = useCallback(
    (action: DocumentAction): string => td(`action.${action}`),
    [td],
  );

  const draftShortcuts3D = mode === '3d' ? (settings).shortcuts : undefined;
  const { bindings: bindings3D } = use3DBindings(
    mode === '3d' ? handle : null,
    draftShortcuts3D,
  );
  const bindings2D = use2DBindings(
    mode === '2d' ? (settings) : { shortcuts: {}, mouseBindings: {}, pageBackground: '', controls: { left: 'none' as const, middle: 'truck' as const, right: 'truck' as const, wheel: 'zoom' as const }, controlsLinked: true },
    documentActionLabel,
  );

  const bindings = mode === '3d' ? bindings3D : bindings2D;
  const [capturing, setCapturing] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);


  const selectedBinding = useMemo(() => {
    if (!selectedCode) return null;
    const comboKey = codeToComboKey(selectedCode);
    return bindings.find((b) => {
      const parts = b.combo.split('+');
      const mainKey = parts[parts.length - 1];
      return mainKey === comboKey && parts.length === 1;
    }) ?? null;
  }, [selectedCode, bindings]);

  const handleCaptureStart = useCallback((command: string) => {
    setCapturing(command);
  }, []);

  const pickKey = useCallback((code: string) => {
    if (capturing) return;
    setSelectedCode(code);
  }, [capturing]);

  const selectFromList = useCallback((command: string) => {
    const b = bindings.find((x) => x.command === command);
    if (b) {
      const parts = b.combo.split('+');
      const mainKey = parts[parts.length - 1];
      const allKeys = KEYBOARD_ROWS_FLAT();
      const match = allKeys.find((k) => codeToComboKey(k) === mainKey);
      if (match) setSelectedCode(match);
    }
  }, [bindings]);

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

      if (mode === '3d') {
        const s = settings;
        (onSettingsChange)({
          ...s,
          shortcuts: { ...s.shortcuts, [capturing]: combo },
        });
      } else {
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
  }, [capturing, mode, settings, onSettingsChange]);

  const capturingBinding = capturing
    ? bindings.find((b) => b.command === capturing) ?? null
    : null;

  return (
    <Tabs defaultValue="keyboard" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="w-full shrink-0 rounded-none bg-transparent p-0 gap-0 border-b border-border">
        <TabsTrigger
          value="keyboard"
          className="rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          {t('tabKeyboard')}
        </TabsTrigger>
        <TabsTrigger
          value="mouse"
          className="rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          {t('tabMouse')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="keyboard" className="relative flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Pinned: keyboard visual */}
          <div className="flex shrink-0 justify-center overflow-x-auto pb-2 pt-3">
            <div style={{ zoom: 0.9 }}>
              <VisualKeyboard
                bindings={bindings}
                capturing={capturing}
                onCaptureStart={handleCaptureStart}
                selectedCode={selectedCode}
                onPick={pickKey}
              />
            </div>
          </div>

          {/* Scrollable shortcut list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pt-2">
            <ShortcutList
              bindings={bindings}
              capturing={capturing}
              onCaptureStart={handleCaptureStart}
              filter={null}
              query=""
              selected={selectedBinding?.command ?? null}
              onSelect={selectFromList}
            />
          </div>

          {/* Capture overlay */}
          {capturing && capturingBinding && (
            <CaptureOverlay
              action={capturingBinding.label}
              combo={capturingBinding.combo}
              cat={CATEGORY_STYLES[capturingBinding.category]}
              onCancel={() => { setCapturing(null); }}
            />
          )}
        </div>
      </TabsContent>

      <TabsContent value="mouse" className="flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Pinned: mouse diagram */}
          <div className="flex shrink-0 justify-center pb-2 pt-3">
            <div style={{ zoom: 0.9 }}>
              {mode === '3d' ? (
                <Mouse3DDiagram
                  settings={settings}
                  selected={selectedCode}
                  onPick={setSelectedCode}
                />
              ) : (
                <Mouse2DDiagram
                  settings={settings}
                  controls3D={(props).controls3D}
                  selected={selectedCode}
                  onPick={setSelectedCode}
                />
              )}
            </div>
          </div>

          {/* Scrollable settings list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {mode === '3d' ? (
              <Mouse3DSettings
                settings={settings}
                onSettingsChange={onSettingsChange}
              />
            ) : (
              <Mouse2DSettings
                settings={settings}
                controls3D={(props).controls3D}
                onSettingsChange={onSettingsChange}
              />
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

function KEYBOARD_ROWS_FLAT(): string[] {
  const codes: string[] = [];
  for (const row of KEYBOARD_ROWS) {
    for (const k of row) {
      if (!k.isSpacer && k.code) codes.push(k.code);
    }
  }
  return codes;
}
