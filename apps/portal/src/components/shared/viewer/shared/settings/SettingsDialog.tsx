'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import {
  AppDialog, Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@bimstitch/ui';
import type { CameraFlyPluginOptions, ViewerHandle } from '@bimstitch/viewer';

import {
  DEFAULT_VIEWER_SETTINGS,
  colorToHex,
  hexToColor,
  loadViewerSettings,
  saveViewerSettings,
  type EffectsQuality,
  type InteractivePerformanceSettings,
  type ViewerSettings,
} from '@/lib/viewerSettings';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  loadDocumentSettings,
  saveDocumentSettings,
  type DocumentSettings,
} from '@/lib/documentSettings';

import { KeyBindingsTab } from './KeyBindingsTab';
import { ColorField, Field, RangeField, Section, Toggle } from './primitives';

// ── Appearance sub-sections ─────────────────────────────────────────

const EFFECTS_QUALITIES: EffectsQuality[] = ['low', 'medium', 'high'];

function Viewer3DSection({
  settings,
  onChange,
}: {
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
}): JSX.Element {
  const t = useTranslations('viewer.settings');
  return (
    <div className="space-y-4">
      <Section title={t('shadows')} note={undefined}>
        <Toggle
          label={t('enableShadows')}
          checked={settings.shadows.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              shadows: { ...settings.shadows, enabled },
            });
          }}
        />
      </Section>
      <Section title={t('visualEffects')} note={undefined}>
        <Toggle
          label={t('enableEffects')}
          checked={settings.effects.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              effects: { ...settings.effects, enabled },
            });
          }}
        />
        <Toggle
          label={t('edgesOutline')}
          checked={settings.outline.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              outline: { ...settings.outline, enabled },
            });
          }}
        />
        <Field label={t('quality')}>
          <Select
            selectSize="md"
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
      <Section title={t('zoomLimits')} note={undefined}>
        <RangeField
          label={t('maxDistance')}
          value={settings.zoom.maxFactor}
          min={2}
          max={20}
          step={0.5}
          format={(v) => `${String(v)}x`}
          onChange={(maxFactor) => {
            onChange({
              ...settings,
              zoom: { ...settings.zoom, maxFactor },
            });
          }}
        />
      </Section>
      <Section title={t('navigationSection')} note={t('sprintHint')}>
        <RangeField
          label={t('movementSpeed')}
          value={settings.cameraFly.moveFraction}
          min={0.05}
          max={0.6}
          step={0.01}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(moveFraction) => {
            onChange({
              ...settings,
              cameraFly: { ...settings.cameraFly, moveFraction },
            });
          }}
        />
        <RangeField
          label={t('turnSpeed')}
          value={settings.cameraFly.turnSpeedDeg}
          min={20}
          max={180}
          step={5}
          format={(v) => `${String(v)}°/s`}
          onChange={(turnSpeedDeg) => {
            onChange({
              ...settings,
              cameraFly: { ...settings.cameraFly, turnSpeedDeg },
            });
          }}
        />
        <RangeField
          label={t('lookSensitivity')}
          value={settings.cameraFly.lookSensitivity}
          min={0.001}
          max={0.006}
          step={0.0005}
          format={(v) => `${(v / 0.0025).toFixed(1)}x`}
          onChange={(lookSensitivity) => {
            onChange({
              ...settings,
              cameraFly: { ...settings.cameraFly, lookSensitivity },
            });
          }}
        />
      </Section>
      <Section title={t('behavior')} note={t('behaviorNoteColor')}>
        <Toggle
          label={t('hoverHighlight')}
          checked={settings.behavior.hoverHighlight.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              behavior: { ...settings.behavior, hoverHighlight: { ...settings.behavior.hoverHighlight, enabled } },
            });
          }}
        />
        <ColorField
          label={t('hoverColor')}
          value={colorToHex(settings.behavior.hoverHighlight.color)}
          onChange={(hex) => {
            onChange({
              ...settings,
              behavior: { ...settings.behavior, hoverHighlight: { ...settings.behavior.hoverHighlight, color: hexToColor(hex) } },
            });
          }}
        />
        <Toggle
          label={t('clickToSelect')}
          checked={settings.behavior.selection.enabled}
          onChange={(enabled) => {
            onChange({
              ...settings,
              behavior: { ...settings.behavior, selection: { ...settings.behavior.selection, enabled } },
            });
          }}
        />
        <ColorField
          label={t('selectionColor')}
          value={colorToHex(settings.behavior.selection.color)}
          onChange={(hex) => {
            onChange({
              ...settings,
              behavior: { ...settings.behavior, selection: { ...settings.behavior.selection, color: hexToColor(hex) } },
            });
          }}
        />
      </Section>
    </div>
  );
}

function DocumentSection(): JSX.Element {
  const t = useTranslations('viewer.settings');
  return (
    <div className="space-y-4">
      <p className="text-body3 text-foreground-secondary">
        {t('noDocumentSettings')}
      </p>
    </div>
  );
}

// ── Unified Appearance tab ──────────────────────────────────────────

function AppearanceTab({
  viewer3D,
  doc2D,
  activeMode,
  onViewer3DChange,
  onDoc2DChange,
}: {
  viewer3D: ViewerSettings;
  doc2D: DocumentSettings;
  activeMode: '3d' | '2d';
  onViewer3DChange: (next: ViewerSettings) => void;
  onDoc2DChange: (next: DocumentSettings) => void;
}): JSX.Element {
  const t = useTranslations('viewer.settings');
  const [subTab, setSubTab] = useState<string>(activeMode === '3d' ? '3d' : 'document');

  return (
    <div className="space-y-4">
      <Section title={t('common')} note={undefined}>
        <ColorField
          label={t('background')}
          value={colorToHex(viewer3D.background.color)}
          onChange={(hex) => {
            onViewer3DChange({ ...viewer3D, background: { color: hexToColor(hex) } });
            onDoc2DChange({ ...doc2D, pageBackground: hex });
          }}
        />
      </Section>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="w-full rounded-none bg-transparent p-0 gap-0 border-b border-border">
          <TabsTrigger
            value="3d"
            className="rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t('sub3dViewer')}
          </TabsTrigger>
          <TabsTrigger
            value="document"
            className="rounded-none border-b-2 border-transparent px-3 pb-2 pt-1.5 -mb-px shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t('subDocument')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="3d" className="pt-3">
          <Viewer3DSection settings={viewer3D} onChange={onViewer3DChange} />
        </TabsContent>

        <TabsContent value="document" className="pt-3">
          <DocumentSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── 3D Performance tab ──────────────────────────────────────────────

function PerformanceTab({
  settings,
  onChange,
}: {
  settings: ViewerSettings;
  onChange: (next: ViewerSettings) => void;
}): JSX.Element {
  const t = useTranslations('viewer.settings');
  const ip = settings.interactivePerformance;
  const update = (
    patch: Partial<InteractivePerformanceSettings>,
  ): void => {
    const next: InteractivePerformanceSettings = {
      ...ip, ...patch,
    };
    onChange({ ...settings, interactivePerformance: next });
  };

  return (
    <div>
      <Section
        title={t('performanceDuringNav')}
        note={undefined}
      >
        <p className="text-body3 text-foreground-secondary">
          {t('performanceDescription')}
        </p>
        <Toggle
          label={t('hideSmall')}
          checked={ip.hideSmall}
          onChange={(v) => { update({ hideSmall: v }); }}
        />
        <Toggle
          label={t('envelopeOnly')}
          checked={ip.envelopeOnly}
          onChange={(v) => { update({ envelopeOnly: v }); }}
        />
        <Toggle
          label={t('hideTransparent')}
          checked={ip.hideTransparent}
          onChange={(v) => { update({ hideTransparent: v }); }}
        />
        <Toggle
          label={t('cullSubPixel')}
          checked={ip.pixelSizeCull}
          onChange={(v) => { update({ pixelSizeCull: v }); }}
        />
        <Toggle
          label={t('lowerResolution')}
          checked={ip.dynamicPixelRatio}
          onChange={(v) => {
            update({ dynamicPixelRatio: v });
          }}
        />
        <Toggle
          label={t('tightenFarPlane')}
          checked={ip.tightenFarPlane}
          onChange={(v) => {
            update({ tightenFarPlane: v });
          }}
        />
        <Toggle
          label={t('flatShading')}
          checked={ip.flatShadeOverride}
          onChange={(v) => {
            update({ flatShadeOverride: v });
          }}
        />
        <Toggle
          label={t('pauseHover')}
          checked={ip.pauseHover}
          onChange={(v) => { update({ pauseHover: v }); }}
        />
      </Section>
    </div>
  );
}

// ── Main dialog ─────────────────────────────────────────────────────

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
  if (prev.outline.enabled !== next.outline.enabled) return true;
  if (prev.effects.quality !== next.effects.quality) return true;
  if (prev.background.color !== next.background.color) return true;
  if (prev.controls.left !== next.controls.left) return true;
  if (prev.controls.middle !== next.controls.middle) return true;
  if (prev.controls.right !== next.controls.right) return true;
  if (prev.controls.wheel !== next.controls.wheel) return true;
  if (prev.zoom.maxFactor !== next.zoom.maxFactor) return true;
  if (prev.behavior.hoverHighlight.color !== next.behavior.hoverHighlight.color) return true;
  if (prev.behavior.selection.color !== next.behavior.selection.color) return true;
  return false;
}

// ── Live command dispatch on Save ───────────────────────────────────

type LiveBinding = { combo: string; command: string };

function applyLiveCommands3D(
  handle: ViewerHandle | null,
  snapshot: ViewerSettings,
  draft: ViewerSettings,
): void {
  if (!handle) return;

  if (snapshot.behavior.hoverHighlight.enabled !== draft.behavior.hoverHighlight.enabled) {
    handle.commands.execute('hover.setEnabled', draft.behavior.hoverHighlight.enabled).catch(() => undefined);
  }
  if (snapshot.behavior.selection.enabled !== draft.behavior.selection.enabled) {
    handle.commands.execute('selection.setEnabled', draft.behavior.selection.enabled).catch(() => undefined);
  }

  const snapIP = snapshot.interactivePerformance;
  const draftIP = draft.interactivePerformance;
  const ipPatch: Partial<InteractivePerformanceSettings> = {};
  for (const key of Object.keys(draftIP) as (keyof InteractivePerformanceSettings)[]) {
    if (snapIP[key] !== draftIP[key]) {
      (ipPatch as Record<string, unknown>)[key] = draftIP[key];
    }
  }
  if (Object.keys(ipPatch).length > 0) {
    handle.commands.execute('interactivePerformance.set', ipPatch).catch(() => undefined);
  }

  const snapFly = snapshot.cameraFly;
  const draftFly = draft.cameraFly;
  const flyPatch: CameraFlyPluginOptions = {};
  if (snapFly.moveFraction !== draftFly.moveFraction) {
    flyPatch.moveFraction = draftFly.moveFraction;
  }
  if (snapFly.turnSpeedDeg !== draftFly.turnSpeedDeg) {
    flyPatch.turnSpeed = (draftFly.turnSpeedDeg * Math.PI) / 180;
  }
  if (snapFly.lookSensitivity !== draftFly.lookSensitivity) {
    flyPatch.lookSensitivity = draftFly.lookSensitivity;
  }
  if (Object.keys(flyPatch).length > 0) {
    handle.commands.execute('cameraFly.setOptions', flyPatch).catch(() => undefined);
  }

  const snapShortcuts = snapshot.shortcuts;
  const draftShortcuts = draft.shortcuts;
  const changedCmds = Object.keys(draftShortcuts).filter(
    (cmd) => draftShortcuts[cmd] !== snapShortcuts[cmd],
  );
  if (changedCmds.length > 0) {
    handle.commands.execute<LiveBinding[]>('shortcuts.list')
      .then((live) => {
        const liveMap = new Map(live.map((b) => [b.command, b.combo]));
        for (const cmd of changedCmds) {
          const oldCombo = liveMap.get(cmd);
          const newCombo = draftShortcuts[cmd];
          if (oldCombo) {
            handle.commands.execute('shortcuts.unbind', { combo: oldCombo }).catch(() => undefined);
          }
          if (newCombo) {
            handle.commands.execute('shortcuts.bind', { combo: newCombo, command: cmd }).catch(() => undefined);
          }
        }
      })
      .catch(() => undefined);
  }

  // Mouse gesture bindings — diff the gesture→command maps. Removed gestures
  // unbind; added/changed gestures (re)bind. Mirrors the keyboard block above.
  const snapMouse = snapshot.mouseBindings;
  const draftMouse = draft.mouseBindings;
  const allGestures = new Set([...Object.keys(snapMouse), ...Object.keys(draftMouse)]);
  for (const gesture of allGestures) {
    const before = snapMouse[gesture];
    const after = draftMouse[gesture];
    if (before === after) continue;
    if (after === undefined) {
      handle.commands.execute('mouseBindings.unbind', { gesture }).catch(() => undefined);
    } else {
      handle.commands.execute('mouseBindings.bind', { gesture, command: after }).catch(() => undefined);
    }
  }
}

// ── Exported dialog ─────────────────────────────────────────────────

export function SettingsDialog(props: Props): JSX.Element {
  const t = useTranslations('viewer.settings');
  const {
    mode, open, onClose, settings, onSettingsChange,
  } = props;

  const [viewer3D, setViewer3D] = useState<ViewerSettings>(
    mode === '3d' ? settings as ViewerSettings : loadViewerSettings,
  );
  const [doc2D, setDoc2D] = useState<DocumentSettings>(
    mode === '2d' ? settings as DocumentSettings : loadDocumentSettings,
  );
  const [activeTab, setActiveTab] = useState('appearance');
  const snapshotRef = useRef<ViewerSettings | null>(null);

  useEffect(() => {
    if (open) {
      if (mode === '3d') {
        setViewer3D(settings as ViewerSettings);
        setDoc2D(loadDocumentSettings());
        snapshotRef.current = structuredClone(settings as ViewerSettings);
      } else {
        setDoc2D(settings as DocumentSettings);
        setViewer3D(loadViewerSettings());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateViewer3D = useCallback((next: ViewerSettings): void => {
    setViewer3D(next);
  }, []);

  const updateDoc2D = useCallback((next: DocumentSettings): void => {
    setDoc2D(next);
  }, []);

  const handleCancel = (): void => {
    snapshotRef.current = null;
    onClose();
  };

  const handleSave = (): void => {
    saveViewerSettings(viewer3D);
    saveDocumentSettings(doc2D);

    if (mode === '3d') {
      (onSettingsChange as (s: ViewerSettings) => void)(viewer3D);
      const snap = snapshotRef.current;
      snapshotRef.current = null;
      if (snap && needsReload(snap, viewer3D)) {
        props.onReloadViewer();
        return;
      }
      if (snap) {
        applyLiveCommands3D(props.handle, snap, viewer3D);
      }
    } else {
      (onSettingsChange as (s: DocumentSettings) => void)(doc2D);
    }
    onClose();
  };

  const handleReset = (): void => {
    setViewer3D(DEFAULT_VIEWER_SETTINGS);
    setDoc2D(DEFAULT_DOCUMENT_SETTINGS);
  };

  return (
    <AppDialog
      open={open}
      onClose={handleCancel}
      title={t('viewerTitle')}
      subtitle={t('viewerSubtitle')}
      width={900}
      height={866}
      bodyClassName="overflow-hidden"
      onReset={handleReset}
      resetLabel={t('resetDefaults')}
      onSave={handleSave}
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="appearance">
            {t('tabAppearance')}
          </TabsTrigger>
          {mode === '3d' && (
            <TabsTrigger value="performance">
              {t('tabPerformance')}
            </TabsTrigger>
          )}
          <TabsTrigger value="keybindings">
            {t('tabKeyBindings')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="flex-1 min-h-0 pt-3">
          <AppearanceTab
            viewer3D={viewer3D}
            doc2D={doc2D}
            activeMode={mode}
            onViewer3DChange={updateViewer3D}
            onDoc2DChange={updateDoc2D}
          />
        </TabsContent>

        {mode === '3d' && (
          <TabsContent value="performance" className="flex-1 min-h-0 pt-3">
            <PerformanceTab
              settings={viewer3D}
              onChange={updateViewer3D}
            />
          </TabsContent>
        )}

        <TabsContent value="keybindings" className="flex flex-1 min-h-0 flex-col overflow-hidden pt-3">
          {mode === '3d' ? (
            <KeyBindingsTab
              mode="3d"
              handle={props.handle}
              settings={viewer3D}
              onSettingsChange={updateViewer3D}
            />
          ) : (
            <KeyBindingsTab
              mode="2d"
              handle={undefined}
              settings={doc2D}
              controls3D={viewer3D.controls}
              onSettingsChange={updateDoc2D}
            />
          )}
        </TabsContent>
      </Tabs>
    </AppDialog>
  );
}
