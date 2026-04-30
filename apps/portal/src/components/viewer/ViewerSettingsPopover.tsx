'use client';

import { RotateCcw, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import type { ViewerHandle } from '@bimstitch/viewer';

import {
  DEFAULT_VIEWER_SETTINGS,
  colorToHex,
  hexToColor,
  saveViewerSettings,
  type EffectsQuality,
  type GhostMode,
  type ShadowQuality,
  type ViewerSettings,
} from '@/lib/viewerSettings';

const VIEWCUBE_CORNERS: ViewerSettings['viewCube']['corner'][] = [
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
];

const SHADOW_QUALITIES: ShadowQuality[] = ['low', 'medium', 'high'];
const EFFECTS_QUALITIES: EffectsQuality[] = ['low', 'medium', 'high'];
const GHOST_MODES: GhostMode[] = ['off', 'on-selection'];

const SELECT_CLS = 'h-7 rounded border border-border bg-background px-2 text-caption text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

type Props = {
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onClose: () => void;
  onReloadViewer: () => void;
};

type Binding = { combo: string; command: string };

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
  if (key.length === 1) key = key.toUpperCase();
  ordered.push(key);
  return ordered.join('+');
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between">
        <h3 className="text-caption font-medium text-foreground">{title}</h3>
        {note !== undefined ? (
          <span className="text-[10px] text-foreground-secondary">{note}</span>
        ) : null}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 text-caption text-foreground-secondary">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-caption text-foreground-secondary">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="h-4 w-4 cursor-pointer accent-primary"
      />
    </label>
  );
}

function ShortcutsSection({
  handle,
  settings,
  onChange,
}: {
  handle: ViewerHandle;
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
}): JSX.Element {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    handle.commands
      .execute<Binding[]>('shortcuts.list')
      .then((list) => {
        setBindings(list);
      })
      .catch(() => undefined);
  }, [handle]);

  const rebind = async (command: string, combo: string): Promise<void> => {
    const existing = bindings.find((b) => b.command === command);
    if (existing) {
      await handle.commands.execute('shortcuts.unbind', {
        combo: existing.combo,
      });
    }
    await handle.commands.execute('shortcuts.bind', { combo, command });
    const next = await handle.commands.execute<Binding[]>('shortcuts.list');
    setBindings(next);
    onChange({
      ...settings,
      shortcuts: { ...settings.shortcuts, [command]: combo },
    });
  };

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
      rebind(capturing, combo).catch(() => undefined);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  return (
    <Section title="Keyboard shortcuts" note="Live">
      <ul
        className="max-h-40 space-y-1 overflow-y-auto"
        data-testid="viewer-settings-shortcuts"
      >
        {bindings.length === 0 ? (
          <li className="text-caption text-foreground-secondary">No shortcuts.</li>
        ) : (
          bindings.map((b) => (
            <li
              key={b.command}
              className="flex items-center justify-between gap-2 text-caption"
            >
              <span className="truncate font-mono text-foreground-secondary">
                {b.command}
              </span>
              <button
                type="button"
                onClick={() => {
                  setCapturing(b.command);
                }}
                className="min-w-[5rem] rounded border border-border px-2 py-0.5 font-mono text-foreground hover:bg-background-secondary"
              >
                {capturing === b.command ? 'Press a key…' : b.combo}
              </button>
            </li>
          ))
        )}
      </ul>
    </Section>
  );
}

export function ViewerSettingsPopover({
  handle,
  settings,
  onSettingsChange,
  onClose,
  onReloadViewer,
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent): void => {
      const node = ref.current;
      if (!node) return;
      if (!node.contains(ev.target as Node)) onClose();
    };
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const update = (next: ViewerSettings): void => {
    saveViewerSettings(next);
    onSettingsChange(next);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Viewer settings"
      data-testid="viewer-settings-popover"
      className="absolute bottom-12 left-1/2 z-20 w-80 -translate-x-1/2 rounded-md border border-border bg-background p-4 shadow-lg"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-body2 font-medium text-foreground">Viewer settings</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="rounded p-1 text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <Section title="ViewCube" note="Applies on next viewer reload">
          <Toggle
            label="Show ViewCube"
            checked={settings.viewCube.enabled}
            onChange={(enabled) => {
              update({
                ...settings,
                viewCube: { ...settings.viewCube, enabled },
              });
            }}
          />
          <Field label="Corner">
            <select
              className={SELECT_CLS}
              value={settings.viewCube.corner}
              onChange={(e) => {
                update({
                  ...settings,
                  viewCube: {
                    ...settings.viewCube,
                    corner: e.target.value as ViewerSettings['viewCube']['corner'],
                  },
                });
              }}
            >
              {VIEWCUBE_CORNERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Shadows" note="Applies on next viewer reload">
          <Toggle
            label="Enable shadows"
            checked={settings.shadows.enabled}
            onChange={(enabled) => {
              update({
                ...settings,
                shadows: { ...settings.shadows, enabled },
              });
            }}
          />
          <Field label="Quality">
            <select
              className={SELECT_CLS}
              value={settings.shadows.quality}
              onChange={(e) => {
                update({
                  ...settings,
                  shadows: {
                    ...settings.shadows,
                    quality: e.target.value as ShadowQuality,
                  },
                });
              }}
            >
              {SHADOW_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Visual effects" note="Applies on next viewer reload">
          <Toggle
            label="Enable effects"
            checked={settings.effects.enabled}
            onChange={(enabled) => {
              update({
                ...settings,
                effects: { ...settings.effects, enabled },
              });
            }}
          />
          <Toggle
            label="Edges (silhouette)"
            checked={settings.effects.edges}
            onChange={(edges) => {
              update({
                ...settings,
                effects: { ...settings.effects, edges },
              });
            }}
          />
          <Toggle
            label="SSAO (ambient occlusion)"
            checked={settings.effects.ssao}
            onChange={(ssao) => {
              update({
                ...settings,
                effects: { ...settings.effects, ssao },
              });
            }}
          />
          <Toggle
            label="Selection outline glow"
            checked={settings.effects.outline}
            onChange={(outline) => {
              update({
                ...settings,
                effects: { ...settings.effects, outline },
              });
            }}
          />
          <Toggle
            label="PBR environment"
            checked={settings.effects.environment}
            onChange={(environment) => {
              update({
                ...settings,
                effects: { ...settings.effects, environment },
              });
            }}
          />
          <Field label="Ghost mode">
            <select
              className={SELECT_CLS}
              value={settings.effects.ghost}
              onChange={(e) => {
                update({
                  ...settings,
                  effects: {
                    ...settings.effects,
                    ghost: e.target.value as GhostMode,
                  },
                });
              }}
            >
              {GHOST_MODES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quality">
            <select
              className={SELECT_CLS}
              value={settings.effects.quality}
              onChange={(e) => {
                update({
                  ...settings,
                  effects: {
                    ...settings.effects,
                    quality: e.target.value as EffectsQuality,
                  },
                });
              }}
            >
              {EFFECTS_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Background" note="Applies on next viewer reload">
          <Field label="Color">
            <input
              type="color"
              value={colorToHex(settings.background.color)}
              onChange={(e) => {
                update({
                  ...settings,
                  background: { color: hexToColor(e.target.value) },
                });
              }}
              className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent"
            />
          </Field>
        </Section>

        {handle ? (
          <ShortcutsSection
            handle={handle}
            settings={settings}
            onChange={update}
          />
        ) : (
          <Section title="Keyboard shortcuts" note={undefined}>
            <p className="text-caption text-foreground-secondary">
              Viewer not ready.
            </p>
          </Section>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <button
            type="button"
            onClick={() => {
              update(DEFAULT_VIEWER_SETTINGS);
            }}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-caption text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </button>
          <button
            type="button"
            onClick={onReloadViewer}
            data-testid="viewer-settings-reload"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-caption font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Reload viewer
          </button>
        </div>
      </div>
    </div>
  );
}
