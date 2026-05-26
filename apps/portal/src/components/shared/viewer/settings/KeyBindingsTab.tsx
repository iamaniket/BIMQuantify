'use client';

import {
  useCallback, useEffect, useMemo, useState, type JSX,
} from 'react';

import {
  Button, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@bimstitch/ui';
import type { ViewerHandle } from '@bimstitch/viewer';

import {
  DOCUMENT_ACTION_LABELS,
  type DocumentAction,
  type DocumentSettings,
} from '@/lib/documentSettings';
import type { CameraAction, ViewerSettings } from '@/lib/viewerSettings';

import {
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  classifyCommand,
} from './shortcutCategories';
import { KEYBOARD_ROWS, codeToComboKey } from './keyboardLayout';
import { MouseDiagram } from './MouseDiagram';
import { ShortcutList } from './ShortcutList';
import { VisualKeyboard } from './VisualKeyboard';
import type { NormalizedBinding, ShortcutCategory } from './types';

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

// ── Inline helper components ────────────────────────────────────────

const SearchIcon = (): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const PencilIcon = (): JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

function ChipLegend({ filter, onFilter, counts }: {
  filter: ShortcutCategory | null;
  onFilter: (cat: ShortcutCategory | null) => void;
  counts: Record<string, number>;
}): JSX.Element {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const cats = Object.keys(CATEGORY_LABELS) as ShortcutCategory[];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant="border" size="sm"
        className="!gap-1.5 !px-2.5 !py-1 !text-caption"
        style={!filter ? { background: 'var(--foreground)', borderColor: 'var(--foreground)', color: 'var(--foreground-inverse)' } : undefined}
        onClick={() => { onFilter(null); }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: !filter ? 'var(--foreground-inverse)' : 'var(--foreground-tertiary)' }} />
        All <span className="opacity-60">{total}</span>
      </Button>
      {cats.map((id) => {
        const cat = CATEGORY_STYLES[id];
        const active = filter === id;
        return (
          <Button
            key={id} variant="border" size="sm"
            className="!gap-1.5 !px-2.5 !py-1 !text-caption"
            style={active ? { background: cat.tint, borderColor: cat.swatch, color: cat.swatch } : undefined}
            onClick={() => { onFilter(active ? null : id); }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: cat.swatch }} />
            {CATEGORY_LABELS[id]} <span className="opacity-60">{counts[id] ?? 0}</span>
          </Button>
        );
      })}
    </div>
  );
}

function prettyKey(combo: string): string {
  if (!combo) return '—';
  return combo
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←').replace('ArrowRight', '→');
}

function SelectedReadout({ code, binding, onRebind, capturing }: {
  code: string;
  binding: NormalizedBinding | null;
  onRebind: () => void;
  capturing: string | null;
}): JSX.Element {
  const cat = binding ? CATEGORY_STYLES[binding.category] : null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-low px-3 py-2">
      <div
        className="flex h-9 min-w-[44px] items-center justify-center rounded-md border-[1.5px] px-2 font-sans text-body3 font-bold"
        style={{
          background: cat ? cat.tint : 'var(--surface-high)',
          borderColor: cat ? cat.swatch : 'var(--border)',
          color: cat ? cat.swatch : 'var(--foreground-tertiary)',
        }}
      >
        {prettyKey(binding?.combo ?? code)}
      </div>
      <div className="min-w-0">
        <div className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
          {cat ? CATEGORY_LABELS[binding!.category] : 'Unassigned'}
        </div>
        <div className="mt-0.5 max-w-[220px] truncate text-body3 font-semibold text-foreground">
          {binding ? binding.label : 'No action bound'}
        </div>
      </div>
      {binding && (
        <Button
          variant="primary" size="sm"
          className="ml-auto !gap-1.5"
          disabled={capturing !== null}
          onClick={onRebind}
        >
          <PencilIcon /> Rebind
        </Button>
      )}
    </div>
  );
}

function CaptureOverlay({ action, combo, cat, onCancel }: {
  action: string;
  combo: string;
  cat: { swatch: string } | null;
  onCancel: () => void;
}): JSX.Element {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [onCancel]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(15,23,42,0.55)' }}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-main p-6 text-center shadow-lg">
        <div className="text-caption font-bold uppercase tracking-widest text-primary">
          Listening for keystroke
        </div>
        <div className="mt-2 text-lg font-medium text-foreground">
          Press any key for{' '}
          <span style={{ color: cat?.swatch ?? 'var(--primary)' }}>{action}</span>
        </div>
        <div className="mt-3 text-body3 text-foreground-tertiary">
          Currently bound to{' '}
          <kbd className="rounded border border-border bg-surface-high px-1.5 py-0.5 font-mono text-caption font-semibold text-foreground">
            {prettyKey(combo)}
          </kbd>
          {' '}· Press <kbd className="rounded border border-border bg-surface-high px-1.5 py-0.5 font-mono text-caption font-semibold text-foreground">Esc</kbd> to cancel
        </div>
      </div>
    </div>
  );
}

// ── Mouse 3D Section (drag-action selects) ──────────────────────────

function Mouse3DSection({
  settings,
  onSettingsChange,
  selected,
  onPick,
}: {
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  selected: string | null;
  onPick: (id: string) => void;
}): JSX.Element {
  const dragLabel = (action: CameraAction): string => {
    const found = CAMERA_ACTIONS.find((a) => a.value === action);
    return found !== undefined ? found.label : action;
  };

  return (
    <>
      <MouseDiagram
        leftButton={{ label: 'Select', sublabel: `Drag: ${dragLabel(settings.controls.left)}` }}
        middleButton={{ label: 'Zoom', sublabel: `Drag: ${dragLabel(settings.controls.middle)}` }}
        rightButton={{ label: 'Pan', sublabel: `Drag: ${dragLabel(settings.controls.right)}` }}
        scrollWheel={`Zoom in/out (${dragLabel(settings.controls.wheel)})`}
        selected={selected}
        onPick={onPick}
      />
      <div className="space-y-2">
        <h4 className="text-caption font-bold uppercase tracking-[0.12em] text-foreground-tertiary">
          Drag actions
        </h4>
        {DRAG_BUTTONS.map((btn) => (
          <label key={btn.key} className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
            <span>{btn.label}</span>
            <Select
              selectSize="sm"
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
                <option key={a.value} value={a.value}>{a.label}</option>
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
            <li key={r.gesture} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-body3">
              <span className="font-mono text-foreground-secondary">{r.gesture}</span>
              <span className="text-foreground">{r.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ── Main export ─────────────────────────────────────────────────────

export function KeyBindingsTab(props: Props): JSX.Element {
  const { mode, settings, onSettingsChange } = props;
  const handle = mode === '3d' ? props.handle : null;

  const draftShortcuts3D = mode === '3d' ? (settings).shortcuts : undefined;
  const { bindings: bindings3D } = use3DBindings(
    mode === '3d' ? handle : null,
    draftShortcuts3D,
  );
  const bindings2D = use2DBindings(
    mode === '2d' ? (settings) : { shortcuts: {}, mouseBindings: {}, pageBackground: '' },
  );

  const bindings = mode === '3d' ? bindings3D : bindings2D;
  const [capturing, setCapturing] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShortcutCategory | null>(null);
  const [query, setQuery] = useState('');

  const selectedBinding = useMemo(() => {
    if (!selectedCode) return null;
    const comboKey = codeToComboKey(selectedCode);
    return bindings.find((b) => {
      const parts = b.combo.split('+');
      const mainKey = parts[parts.length - 1];
      return mainKey === comboKey && parts.length === 1;
    }) ?? null;
  }, [selectedCode, bindings]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of bindings) c[b.category] = (c[b.category] ?? 0) + 1;
    return c;
  }, [bindings]);

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
        const s = settings as ViewerSettings;
        (onSettingsChange as (n: ViewerSettings) => void)({
          ...s,
          shortcuts: { ...s.shortcuts, [capturing]: combo },
        });
      } else {
        const s = settings as DocumentSettings;
        (onSettingsChange as (n: DocumentSettings) => void)({
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
    <Tabs defaultValue="keyboard" className="flex flex-col flex-1">
      <TabsList className="w-full shrink-0 rounded-none bg-transparent p-0 gap-0 border-b border-border">
        <TabsTrigger
          value="keyboard"
          className="rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          Keyboard
        </TabsTrigger>
        <TabsTrigger
          value="mouse"
          className="rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
        >
          Mouse
        </TabsTrigger>
      </TabsList>

      <TabsContent value="keyboard" className="relative flex flex-1 min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden">
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Pinned: keyboard visual */}
          <div className="flex shrink-0 justify-center overflow-x-auto pb-2 pt-3">
            <VisualKeyboard
              bindings={bindings}
              capturing={capturing}
              onCaptureStart={handleCaptureStart}
              selectedCode={selectedCode}
              onPick={pickKey}
            />
          </div>

          {/* Scrollable region */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pt-2">
            {/* Toolbar: chips + search */}
            <div className="flex flex-wrap items-center gap-2 px-1">
              <ChipLegend filter={filter} onFilter={setFilter} counts={counts} />
              <div className="flex-1" />
              <Input
                inputSize="sm"
                className="w-48"
                leading={<SearchIcon />}
                trailing={query ? (
                  <button
                    type="button"
                    className="text-foreground-tertiary hover:text-foreground"
                    onClick={() => { setQuery(''); }}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : undefined}
                placeholder="Search actions…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); }}
              />
            </div>

            {/* Selected readout */}
            {selectedCode && (
              <SelectedReadout
                code={selectedCode}
                binding={selectedBinding}
                capturing={capturing}
                onRebind={() => {
                  if (selectedBinding) handleCaptureStart(selectedBinding.command);
                }}
              />
            )}

            {/* List */}
            <ShortcutList
              bindings={bindings}
              capturing={capturing}
              onCaptureStart={handleCaptureStart}
              filter={filter}
              query={query}
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

      <TabsContent value="mouse" className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-4 pt-3">
          {mode === '3d' ? (
            <Mouse3DSection
              settings={settings}
              onSettingsChange={onSettingsChange}
              selected={selectedCode}
              onPick={setSelectedCode}
            />
          ) : (
            <Mouse2DSection />
          )}
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
