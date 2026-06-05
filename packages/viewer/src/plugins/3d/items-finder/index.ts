import type { Plugin, ViewerContext, ItemId } from '../../../core/types.js';

const NAME = 'items-finder' as const;

export type FinderOperator = 'equals' | 'contains' | 'startsWith' | 'endsWith';

export interface FinderQuery {
  property?: string;
  value?: string;
  operator?: FinderOperator;
}

export interface ItemsFinderPluginAPI {
  search(query: FinderQuery): Promise<ItemId[]>;
  results(): ItemId[];
  clear(): void;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function operatorToRegex(value: string, operator: FinderOperator): RegExp {
  const escaped = escapeRegex(value);
  switch (operator) {
    case 'equals':
      return new RegExp(`^${escaped}$`, 'i');
    case 'startsWith':
      return new RegExp(`^${escaped}`, 'i');
    case 'endsWith':
      return new RegExp(`${escaped}$`, 'i');
    case 'contains':
    default:
      return new RegExp(escaped, 'i');
  }
}

export function itemsFinderPlugin(): Plugin & ItemsFinderPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let currentResults: ItemId[] = [];

  const doSearch = async (query: FinderQuery): Promise<ItemId[]> => {
    if (!ctxRef || !query.property || !query.value) return [];
    const results: ItemId[] = [];
    const models = ctxRef.models();
    const operator = query.operator ?? 'contains';

    const nameRegex = new RegExp(escapeRegex(query.property), 'i');
    const valueRegex = operatorToRegex(query.value, operator);

    for (const [modelId, model] of models) {
      try {
        const localIds = await model.getItemsByQuery({
          attributes: {
            queries: [{ name: nameRegex, value: valueRegex }],
          },
        });
        for (const localId of localIds) {
          results.push({ modelId, localId });
        }
      } catch {
        // Model may not support query — skip
      }
    }

    return results;
  };

  const api: Plugin & ItemsFinderPluginAPI = {
    name: NAME,

    async search(query) {
      currentResults = await doSearch(query);
      ctxRef?.events.emit('finder:results', {
        query: query as Record<string, unknown>,
        results: currentResults,
        count: currentResults.length,
      });
      return currentResults;
    },

    results() {
      return [...currentResults];
    },

    clear() {
      currentResults = [];
      ctxRef?.events.emit('finder:results', {
        query: {},
        results: [],
        count: 0,
      });
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('finder.search', async (args: unknown) => {
        const query = args as FinderQuery;
        return api.search(query);
      }, { title: 'Search model items' });

      ctx.commands.register('finder.highlight', async () => {
        if (currentResults.length > 0) {
          await ctx.commands.execute('selection.clear');
          await ctx.commands.execute('selection.pickSet', { items: currentResults });
        }
      }, { title: 'Highlight search results' });

      ctx.commands.register('finder.isolate', async () => {
        if (currentResults.length > 0) {
          await ctx.commands.execute('selection.pickSet', { items: currentResults });
          await ctx.commands.execute('visibility.isolate');
        }
      }, { title: 'Isolate search results' });

      ctx.commands.register('finder.clear', () => api.clear(), {
        title: 'Clear search results',
      });
    },

    uninstall() {
      currentResults = [];
      ctxRef = null;
    },
  };

  return api;
}
