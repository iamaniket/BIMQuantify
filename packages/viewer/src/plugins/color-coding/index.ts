import * as THREE from 'three';

import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';
import type { ClassifierPluginAPI } from '../classifier/index.js';

const NAME = 'color-coding' as const;

export type ColorScheme = 'category' | 'spatialStructure' | 'custom';

export interface ColorCodingOptions {
  defaultColor?: number;
}

export interface LegendEntry {
  name: string;
  color: number;
  count: number;
}

export interface ColorCodingPluginAPI {
  apply(scheme: ColorScheme, colorMap?: Record<string, number>): Promise<void>;
  clear(): Promise<void>;
  isActive(): boolean;
  activeScheme(): ColorScheme | null;
  legend(): LegendEntry[];
}

// Golden-ratio hue stepping for deterministic, evenly-spaced colors.
const autoColor = (index: number): THREE.Color => {
  const hue = (index * 137.508) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.65, 0.55);
};

export function colorCodingPlugin(
  options: ColorCodingOptions = {},
): Plugin & ColorCodingPluginAPI {
  const defaultColor = new THREE.Color(options.defaultColor ?? 0x888888);

  let ctxRef: ViewerContext | null = null;
  let currentScheme: ColorScheme | null = null;
  let currentLegend: LegendEntry[] = [];

  // Track colored items so we can resetColor on clear.
  const coloredGroups = new Map<string, { items: ItemId[]; color: THREE.Color }>();

  const groupByModel = (items: ItemId[]): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const it of items) {
      let arr = map.get(it.modelId);
      if (!arr) { arr = []; map.set(it.modelId, arr); }
      arr.push(it.localId);
    }
    return map;
  };

  const emitChange = (): void => {
    ctxRef?.events.emit('colorCoding:change', {
      active: currentScheme !== null,
      scheme: currentScheme,
      legend: currentLegend,
    });
  };

  const clearColors = async (): Promise<void> => {
    if (!ctxRef || coloredGroups.size === 0) return;
    const allItems: ItemId[] = [];
    for (const g of coloredGroups.values()) {
      allItems.push(...g.items);
    }
    const byModel = groupByModel(allItems);
    for (const [modelId, ids] of byModel) {
      const model = ctxRef.models().get(modelId);
      if (model) await model.resetColor(ids).catch(() => undefined);
    }
    coloredGroups.clear();
    currentScheme = null;
    currentLegend = [];
  };

  const applyColors = async (
    scheme: ColorScheme,
    colorMap?: Record<string, number>,
  ): Promise<void> => {
    if (!ctxRef) return;

    // Clear previous coding first.
    await clearColors();

    const classifier = ctxRef.plugins.get<ClassifierPluginAPI>('classifier');
    if (!classifier) return;

    // Ensure classification exists for the requested scheme.
    const classifyStrategy = scheme === 'category' ? 'category' : 'spatialStructure';
    if (scheme !== 'custom') {
      const groups = classifier.groups();
      if (!groups.has(classifyStrategy)) {
        await classifier.classify(classifyStrategy);
      }
    }

    const groups = classifier.groups();
    const targetGroups = scheme === 'custom'
      ? groups.get('category') ?? groups.get('spatialStructure') ?? []
      : groups.get(classifyStrategy) ?? [];

    if (!targetGroups.length) return;

    const legend: LegendEntry[] = [];

    for (let i = 0; i < targetGroups.length; i++) {
      const group = targetGroups[i]!;
      if (group.items.length === 0) continue;

      let threeColor: THREE.Color;
      if (colorMap && colorMap[group.name] !== undefined) {
        threeColor = new THREE.Color(colorMap[group.name]);
      } else if (scheme === 'custom') {
        threeColor = defaultColor.clone();
      } else {
        threeColor = autoColor(i);
      }

      const byModel = groupByModel(group.items);
      for (const [modelId, ids] of byModel) {
        const model = ctxRef.models().get(modelId);
        if (model) await model.setColor(ids, threeColor).catch(() => undefined);
      }

      coloredGroups.set(group.name, { items: group.items, color: threeColor });
      legend.push({
        name: group.name,
        color: (threeColor.r * 255) << 16 | (threeColor.g * 255) << 8 | (threeColor.b * 255),
        count: group.items.length,
      });
    }

    currentScheme = scheme;
    currentLegend = legend;
    emitChange();
  };

  const clear = async (): Promise<void> => {
    await clearColors();
    emitChange();
  };

  const toggle = async (
    scheme?: ColorScheme,
    colorMap?: Record<string, number>,
  ): Promise<void> => {
    if (currentScheme !== null) {
      await clear();
    } else {
      await applyColors(scheme ?? 'category', colorMap);
    }
  };

  const api: Plugin & ColorCodingPluginAPI = {
    name: NAME,
    dependencies: ['classifier'],

    apply: applyColors,
    clear,
    isActive: () => currentScheme !== null,
    activeScheme: () => currentScheme,
    legend: () => [...currentLegend],

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'colorCoding.apply',
        (args: unknown) => {
          const a = args as { scheme?: ColorScheme; colorMap?: Record<string, number> } | undefined;
          return applyColors(a?.scheme ?? 'category', a?.colorMap);
        },
        { title: 'Apply color coding' },
      );

      ctx.commands.register('colorCoding.clear', () => clear(), {
        title: 'Clear color coding',
      });

      ctx.commands.register(
        'colorCoding.toggle',
        (args: unknown) => {
          const a = args as { scheme?: ColorScheme; colorMap?: Record<string, number> } | undefined;
          return toggle(a?.scheme, a?.colorMap);
        },
        { title: 'Toggle color coding' },
      );

      ctx.commands.register('colorCoding.isActive', () => api.isActive(), {
        title: 'Check color coding state',
      });

      ctx.commands.register('colorCoding.legend', () => api.legend(), {
        title: 'Get color legend',
      });

      ctx.events.on('model:loaded', () => {
        if (currentScheme !== null) {
          const scheme = currentScheme;
          void clearColors().then(() => applyColors(scheme));
        }
      });
    },

    uninstall() {
      if (ctxRef) void clearColors();
      ctxRef = null;
    },
  };

  return api;
}
