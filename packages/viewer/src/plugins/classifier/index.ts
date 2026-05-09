import { Classifier } from '@thatopen/components';

import type { Plugin, ViewerContext, ItemId } from '../../core/types.js';

const NAME = 'classifier' as const;

export type ClassificationStrategy = 'category' | 'spatialStructure' | 'model';

export interface ClassificationGroup {
  name: string;
  items: ItemId[];
}

export interface ClassifierPluginAPI {
  groups(): Map<string, ClassificationGroup[]>;
  classify(strategy: ClassificationStrategy): Promise<void>;
  reset(): void;
}

export function classifierPlugin(): Plugin & ClassifierPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let classifier: Classifier | null = null;
  const classificationGroups = new Map<string, ClassificationGroup[]>();

  const emitChange = (): void => {
    const flat: Record<string, ItemId[]> = {};
    for (const [key, groups] of classificationGroups) {
      flat[key] = groups.flatMap((g) => g.items);
    }
    ctxRef?.events.emit('classification:change', { groups: flat });
  };

  const extractGroups = (): void => {
    if (!classifier) return;
    classificationGroups.clear();

    for (const [systemName, system] of classifier.list) {
      const groups: ClassificationGroup[] = [];
      for (const [groupName, groupData] of system) {
        const items: ItemId[] = [];
        const map = groupData.map;
        for (const [modelId, localIds] of Object.entries(map)) {
          if (localIds) {
            for (const localId of localIds) {
              items.push({ modelId, localId });
            }
          }
        }
        groups.push({ name: groupName, items });
      }
      classificationGroups.set(systemName, groups);
    }
  };

  const classifyByCategory = async (): Promise<void> => {
    if (!classifier) return;
    await classifier.byCategory();
    extractGroups();
    emitChange();
  };

  const classifyBySpatialStructure = async (): Promise<void> => {
    if (!classifier) return;
    await classifier.byIfcBuildingStorey();
    extractGroups();
    emitChange();
  };

  const classifyByModel = async (): Promise<void> => {
    if (!classifier) return;
    await classifier.byModel();
    extractGroups();
    emitChange();
  };

  const api: Plugin & ClassifierPluginAPI = {
    name: NAME,

    groups() {
      return new Map(classificationGroups);
    },

    async classify(strategy) {
      switch (strategy) {
        case 'category':
          await classifyByCategory();
          break;
        case 'spatialStructure':
          await classifyBySpatialStructure();
          break;
        case 'model':
          await classifyByModel();
          break;
      }
    },

    reset() {
      classifier?.list.clear();
      classificationGroups.clear();
      emitChange();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      classifier = ctx.components.get(Classifier);

      ctx.commands.register('classifier.byCategory', () => classifyByCategory(), {
        title: 'Classify by IFC category',
      });
      ctx.commands.register('classifier.bySpatialStructure', () => classifyBySpatialStructure(), {
        title: 'Classify by spatial structure (storeys)',
      });
      ctx.commands.register('classifier.byModel', () => classifyByModel(), {
        title: 'Classify by model',
      });
      ctx.commands.register('classifier.getGroups', () => {
        const result: Record<string, ClassificationGroup[]> = {};
        for (const [key, groups] of classificationGroups) {
          result[key] = groups;
        }
        return result;
      }, { title: 'Get classification groups' });
      ctx.commands.register('classifier.setVisible', async (args: unknown) => {
        const { group, visible } = args as { group: string; visible: boolean };
        if (!ctxRef) return;
        for (const groups of classificationGroups.values()) {
          const found = groups.find((g) => g.name === group);
          if (found) {
            const byModel = new Map<string, number[]>();
            for (const item of found.items) {
              const arr = byModel.get(item.modelId) ?? [];
              arr.push(item.localId);
              byModel.set(item.modelId, arr);
            }
            for (const [modelId, localIds] of byModel) {
              const model = ctxRef.models().get(modelId);
              if (model) {
                await model.setVisible(localIds, visible);
              }
            }
          }
        }
        ctxRef.events.emit('visibility:change', { hidden: [], isolated: [], isolationActive: false });
      }, { title: 'Show/hide items by classification group' });
      ctx.commands.register('classifier.reset', () => api.reset(), {
        title: 'Reset classifications',
      });
    },

    uninstall() {
      classificationGroups.clear();
      classifier = null;
      ctxRef = null;
    },
  };

  return api;
}
