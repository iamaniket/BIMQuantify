'use client';

import { useRef, type JSX, type ReactNode } from 'react';

import {
  AppDialog, Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@bimstitch/ui';
import type { ViewerHandle } from '@bimstitch/viewer';

import {
  DEFAULT_VIEWER_SETTINGS,
  colorToHex,
  hexToColor,
  saveViewerSettings,
  type EffectsQuality,
  type InteractivePerformanceSettings,
  type ViewerSettings,
} from '@/lib/viewerSettings';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  saveDocumentSettings,
  type DocumentSettings,
} from '@/lib/documentSettings';

import { KeyBindingsTab } from './KeyBindingsTab';

// ── Shared primitives ────────────────────────────────────────────────

function Section({ title, note, children }: {
  title: string;
  note: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <header className="flex items-baseline justify-between">
        <h3 className="text-caption font-medium text-foreground">{title}</h3>
        {note !== undefined && <span className="text-caption text-foreground-secondary">{note}</span>}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 text-body3 text-foreground-secondary">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-body3 text-foreground-secondary">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => { onChange(e.target.checked); }}
        className="h-4 w-4 cursor-pointer accent-primary"
      />
    </label>
  );
}

// ── 3D Appearance tab ────────────────────────────────────────────────

const EFFECTS_QUALITIES: EffectsQuality[] = ['low', 'medium', 'high'];

function AppearanceTab({
  settings,
  onChange,
}: {
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
}): JSX.Element {
  return (
    <div className="space-y-4 pt-3">
      <Section title="Shadows" note={undefined}>
        <Toggle
          label="Enable shadows"
          checked={settings.shadows.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              shadows: { ...settings.shadows, enabled },
            });
          }}
        />
      </Section>
      <Section title="Visual effects" note={undefined}>
        <Toggle
          label="Enable effects"
          checked={settings.effects.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              effects: { ...settings.effects, enabled },
            });
          }}
        />
        <Toggle
          label="Edges (silhouette)"
          checked={settings.effects.edges}
          onChange={(edges) => {
            onChange({
              ...settings,
              effects: { ...settings.effects, edges },
            });
          }}
        />
        <Field label="Quality">
          <Select
            selectSize="sm"
            value={settings.effects.quality}
            onChange={(e) => {
              onChange({
                ...settings,
                effects: {
                  ...settings.effects,
                  quality: e.target.value as EffectsQuality,
                },
              });
            }}
          >
            {EFFECTS_QUALITIES.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </Select>
        </Field>
      </Section>
      <Section title="Background" note={undefined}>
        <Field label="Color">
          <input
            type="color"
            value={colorToHex(settings.background.color)}
            onChange={(e) => {
              onChange({
                ...settings,
                background: { color: hexToColor(e.target.value) },
              });
            }}
            className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent"
          />
        </Field>
      </Section>
    </div>
  );
}

// ── 3D Performance tab ───────────────────────────────────────────────

function PerformanceTab({
  handle,
  settings,
  onChange,
}: {
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
}): JSX.Element {
  const ip = settings.interactivePerformance;
  const update = (
    patch: Partial<InteractivePerformanceSettings>,
  ): void => {
    const next: InteractivePerformanceSettings = {
      ...ip, ...patch,
    };
    onChange({ ...settings, interactivePerformance: next });
    if (handle) {
      handle.commands
        .execute('interactivePerformance.set', patch)
        .catch(() => undefined);
    }
  };

  return (
    <div className="pt-3">
      <Section
        title="Performance during navigation"
        note="Live"
      >
        <p className="text-body3 text-foreground-secondary">
          Skip work while the camera is moving.
          Restored on idle.
        </p>
        <Toggle
          label="Hide small items"
          checked={ip.hideSmall}
          onChange={(v) => { update({ hideSmall: v }); }}
        />
        <Toggle
          label="Envelope only (walls/slabs/roof/doors/windows)"
          checked={ip.envelopeOnly}
          onChange={(v) => { update({ envelopeOnly: v }); }}
        />
        <Toggle
          label="Hide transparent items"
          checked={ip.hideTransparent}
          onChange={(v) => { update({ hideTransparent: v }); }}
        />
        <Toggle
          label="Cull sub-pixel items"
          checked={ip.pixelSizeCull}
          onChange={(v) => { update({ pixelSizeCull: v }); }}
        />
        <Toggle
          label="Lower resolution while moving"
          checked={ip.dynamicPixelRatio}
          onChange={(v) => {
            update({ dynamicPixelRatio: v });
          }}
        />
        <Toggle
          label="Tighten far plane"
          checked={ip.tightenFarPlane}
          onChange={(v) => {
            update({ tightenFarPlane: v });
          }}
        />
        <Toggle
          label="Flat shading override"
          checked={ip.flatShadeOverride}
          onChange={(v) => {
            update({ flatShadeOverride: v });
          }}
        />
        <Toggle
          label="Pause hover-highlight"
          checked={ip.pauseHover}
          onChange={(v) => { update({ pauseHover: v }); }}
        />
      </Section>
    </div>
  );
}

// ── 2D General tab ───────────────────────────────────────────────────

function GeneralTab({
  settings,
  onChange,
}: {
  settings: DocumentSettings;
  onChange: (next: DocumentSettings) => void;
}): JSX.Element {
  return (
    <div className="space-y-4 pt-3">
      <Section title="Page background" note={undefined}>
        <Field label="Colour">
          <input
            type="color"
            value={settings.pageBackground}
            onChange={(e) => { onChange({ ...settings, pageBackground: e.target.value }); }}
            className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent"
          />
        </Field>
      </Section>
    </div>
  );
}

// ── Main dialog ──────────────────────────────────────────────────────

type Props3D = {
  mode: '3d';
  open: boolean;
  onClose: () => void;
  handle: ViewerHandle | null;
  settings: ViewerSettings;
  onSettingsChange: (next: ViewerSettings) => void;
  onReloadViewer: () => void;
};

type Props2D = {
  mode: '2d';
  open: boolean;
  onClose: () => void;
  handle: undefined;
  settings: DocumentSettings;
  onSettingsChange: (next: DocumentSettings) => void;
  onReloadViewer: undefined;
};

type Props = Props3D | Props2D;

function needsReload(prev: ViewerSettings, next: ViewerSettings): boolean {
  if (prev.shadows.enabled !== next.shadows.enabled) return true;
  if (prev.effects.enabled !== next.effects.enabled) return true;
  if (prev.effects.edges !== next.effects.edges) return true;
  if (prev.effects.quality !== next.effects.quality) return true;
  if (prev.background.color !== next.background.color) return true;
  if (prev.controls.left !== next.controls.left) return true;
  if (prev.controls.middle !== next.controls.middle) return true;
  if (prev.controls.right !== next.controls.right) return true;
  if (prev.controls.wheel !== next.controls.wheel) return true;
  return false;
}

export function ViewerSettingsDialog(props: Props): JSX.Element {
  const {
    mode, open, onClose, settings, onSettingsChange,
  } = props;

  const snapshotRef = useRef<ViewerSettings | null>(null);

  const handleOpenChange = (): void => {
    if (mode === '3d' && snapshotRef.current) {
      if (needsReload(snapshotRef.current, settings)) {
        props.onReloadViewer();
      }
      snapshotRef.current = null;
    }
    onClose();
  };

  if (open && !snapshotRef.current && mode === '3d') {
    snapshotRef.current = structuredClone(settings);
  }

  const update3D = (next: ViewerSettings): void => {
    saveViewerSettings(next);
    (onSettingsChange as (s: ViewerSettings) => void)(next);
  };

  const update2D = (next: DocumentSettings): void => {
    saveDocumentSettings(next);
    (onSettingsChange as (s: DocumentSettings) => void)(next);
  };

  const handleReset = (): void => {
    if (mode === '3d') {
      update3D(DEFAULT_VIEWER_SETTINGS);
    } else {
      update2D(DEFAULT_DOCUMENT_SETTINGS);
    }
  };

  return (
    <AppDialog
      open={open}
      onClose={handleOpenChange}
      title="Viewer Settings"
      width={900}
      height={760}
      bodyClassName="overflow-hidden"
      onReset={handleReset}
      resetLabel="Reset defaults"
    >
      <Tabs defaultValue="keybindings" className="flex flex-1 flex-col">
        <TabsList className="shrink-0">
          {mode === '3d' && (
            <TabsTrigger value="appearance" className="flex-1 text-caption">
              Appearance
            </TabsTrigger>
          )}
          {mode === '2d' && (
            <TabsTrigger value="general" className="flex-1 text-caption">
              General
            </TabsTrigger>
          )}
          {mode === '3d' && (
            <TabsTrigger value="performance" className="flex-1 text-caption">
              Performance
            </TabsTrigger>
          )}
          <TabsTrigger value="keybindings" className="flex-1 text-caption">
            Key Bindings
          </TabsTrigger>
        </TabsList>

        {mode === '3d' && (
          <TabsContent value="appearance" className="flex-1 min-h-0 overflow-y-auto">
            <AppearanceTab
              settings={settings}
              onChange={update3D}
            />
          </TabsContent>
        )}

        {mode === '2d' && (
          <TabsContent value="general" className="flex-1 min-h-0 overflow-y-auto">
            <GeneralTab
              settings={settings}
              onChange={update2D}
            />
          </TabsContent>
        )}

        {mode === '3d' && (
          <TabsContent value="performance" className="flex-1 min-h-0 overflow-y-auto">
            <PerformanceTab
              handle={props.handle}
              settings={settings}
              onChange={update3D}
            />
          </TabsContent>
        )}

        <TabsContent value="keybindings" className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {mode === '3d' ? (
            <KeyBindingsTab
              mode="3d"
              handle={props.handle}
              settings={settings}
              onSettingsChange={update3D}
            />
          ) : (
            <KeyBindingsTab
              mode="2d"
              handle={undefined}
              settings={settings}
              onSettingsChange={update2D}
            />
          )}
        </TabsContent>
      </Tabs>
    </AppDialog>
  );
}
