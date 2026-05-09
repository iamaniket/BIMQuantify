import { BCFTopics } from '@thatopen/components';
import type { Topic } from '@thatopen/components';

import type { Plugin, ViewerContext } from '../../core/types.js';
import type { ViewpointsPluginAPI, Viewpoint } from '../viewpoints/index.js';

const NAME = 'bcf' as const;

export interface BcfComment {
  guid: string;
  text: string;
  author: string;
  date: string;
}

export interface BcfTopicSummary {
  guid: string;
  title: string;
  description?: string;
  status: string;
  type: string;
  priority?: string;
  assignedTo?: string;
  viewpoint?: Viewpoint;
  comments: BcfComment[];
  createdAt: string;
  modifiedAt?: string;
}

export interface BcfPluginAPI {
  importBcf(data: ArrayBuffer): Promise<BcfTopicSummary[]>;
  exportBcf(): Promise<Blob>;
  createTopic(data: { title: string; description?: string; type?: string; status?: string; priority?: string }): BcfTopicSummary;
  updateTopic(guid: string, data: Partial<{ title: string; description: string; status: string; type: string; priority: string }>): void;
  deleteTopic(guid: string): void;
  listTopics(): BcfTopicSummary[];
  navigateToTopic(guid: string): Promise<void>;
}

export function bcfPlugin(): Plugin & BcfPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let bcfTopics: BCFTopics | null = null;
  const topicViewpoints = new Map<string, Viewpoint>();

  const emitChange = (): void => {
    ctxRef?.events.emit('bcf:change', {
      topics: api.listTopics().map((t) => ({ guid: t.guid, title: t.title, status: t.status })),
    });
  };

  const topicToSummary = (topic: Topic): BcfTopicSummary => {
    const vp = topicViewpoints.get(topic.guid);
    return {
      guid: topic.guid,
      title: topic.title,
      status: topic.status,
      type: topic.type,
      comments: [],
      createdAt: topic.creationDate.toISOString(),
      ...(topic.description != null ? { description: topic.description } : {}),
      ...(topic.priority != null ? { priority: topic.priority } : {}),
      ...(topic.assignedTo != null ? { assignedTo: topic.assignedTo } : {}),
      ...(vp != null ? { viewpoint: vp } : {}),
      ...(topic.modifiedDate != null ? { modifiedAt: topic.modifiedDate.toISOString() } : {}),
    };
  };

  const api: Plugin & BcfPluginAPI = {
    name: NAME,
    dependencies: ['viewpoints', 'camera'],

    async importBcf(data) {
      if (!bcfTopics) return [];
      const uint8 = new Uint8Array(data);
      await bcfTopics.load(uint8);

      const results: BcfTopicSummary[] = [];
      for (const [, topic] of bcfTopics.list) {
        const viewpointsApi = ctxRef?.plugins.get<ViewpointsPluginAPI>('viewpoints');
        if (viewpointsApi) {
          const vp = viewpointsApi.save(`BCF: ${topic.title}`, { includeSnapshot: false });
          topicViewpoints.set(topic.guid, vp);
        }
        results.push(topicToSummary(topic));
      }
      emitChange();
      return results;
    },

    async exportBcf() {
      if (!bcfTopics) throw new Error('BCF plugin not initialized');
      return bcfTopics.export();
    },

    createTopic(data) {
      if (!bcfTopics) throw new Error('BCF plugin not initialized');
      const topic = bcfTopics.create({
        title: data.title,
        type: data.type ?? 'Issue',
        status: data.status ?? 'Open',
        creationAuthor: 'BIMQuantify',
        creationDate: new Date(),
        labels: new Set<string>(),
        ...(data.description != null ? { description: data.description } : {}),
        ...(data.priority != null ? { priority: data.priority } : {}),
      });

      const viewpointsApi = ctxRef?.plugins.get<ViewpointsPluginAPI>('viewpoints');
      if (viewpointsApi) {
        const vp = viewpointsApi.save(`BCF: ${topic.title}`, { includeSnapshot: true });
        topicViewpoints.set(topic.guid, vp);
      }

      emitChange();
      return topicToSummary(topic);
    },

    updateTopic(guid, data) {
      if (!bcfTopics) return;
      const topic = bcfTopics.list.get(guid);
      if (!topic) return;
      if (data.title !== undefined) topic.title = data.title;
      if (data.description !== undefined) topic.description = data.description;
      if (data.status !== undefined) topic.status = data.status;
      if (data.type !== undefined) topic.type = data.type;
      if (data.priority !== undefined) topic.priority = data.priority;
      topic.modifiedDate = new Date();
      emitChange();
    },

    deleteTopic(guid) {
      if (!bcfTopics) return;
      bcfTopics.list.delete(guid);
      const vp = topicViewpoints.get(guid);
      if (vp) {
        const viewpointsApi = ctxRef?.plugins.get<ViewpointsPluginAPI>('viewpoints');
        viewpointsApi?.remove(vp.id);
        topicViewpoints.delete(guid);
      }
      emitChange();
    },

    listTopics() {
      if (!bcfTopics) return [];
      const results: BcfTopicSummary[] = [];
      for (const [, topic] of bcfTopics.list) {
        results.push(topicToSummary(topic));
      }
      return results;
    },

    async navigateToTopic(guid) {
      const vp = topicViewpoints.get(guid);
      if (vp) {
        const viewpointsApi = ctxRef?.plugins.get<ViewpointsPluginAPI>('viewpoints');
        await viewpointsApi?.restore(vp.id, { animate: true });
      }
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      bcfTopics = ctx.components.get(BCFTopics);
      // Initialize defaults (types/statuses/priorities, etc.). Idempotent.
      bcfTopics.setup();

      ctx.commands.register('bcf.import', async (args: unknown) => {
        const { data } = args as { data: ArrayBuffer };
        return api.importBcf(data);
      }, { title: 'Import BCF' });

      ctx.commands.register('bcf.export', () => api.exportBcf(), {
        title: 'Export BCF',
      });

      ctx.commands.register('bcf.createTopic', (args: unknown) => {
        return api.createTopic(args as { title: string; description?: string; type?: string; status?: string; priority?: string });
      }, { title: 'Create BCF topic' });

      ctx.commands.register('bcf.updateTopic', (args: unknown) => {
        const { guid, ...data } = args as { guid: string; title?: string; description?: string; status?: string; type?: string; priority?: string };
        api.updateTopic(guid, data);
      }, { title: 'Update BCF topic' });

      ctx.commands.register('bcf.deleteTopic', (args: unknown) => {
        const { guid } = args as { guid: string };
        api.deleteTopic(guid);
      }, { title: 'Delete BCF topic' });

      ctx.commands.register('bcf.listTopics', () => api.listTopics(), {
        title: 'List BCF topics',
      });

      ctx.commands.register('bcf.navigateToTopic', async (args: unknown) => {
        const { guid } = args as { guid: string };
        await api.navigateToTopic(guid);
      }, { title: 'Navigate to BCF topic viewpoint' });
    },

    uninstall() {
      topicViewpoints.clear();
      bcfTopics = null;
      ctxRef = null;
    },
  };

  return api;
}
