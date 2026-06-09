/**
 * 2D PDF markup — a shared `markup-core` plugin plus one plugin per shape.
 * Register the whole set in one line with {@link markupPlugins} (core first, as
 * the shape plugins depend on it).
 */

import type { DocumentPlugin } from '../../../pdf-core/documentTypes.js';
import { markupCorePlugin } from './core/index.js';
import { markupRectPlugin } from './rect/index.js';
import { markupArrowPlugin } from './arrow/index.js';
import { markupCloudPlugin } from './cloud/index.js';
import { markupFreehandPlugin } from './freehand/index.js';
import { markupTextPlugin } from './text/index.js';

export { markupCorePlugin, MARKUP_CORE_NAME } from './core/index.js';
export { markupRectPlugin } from './rect/index.js';
export { markupArrowPlugin } from './arrow/index.js';
export { markupCloudPlugin } from './cloud/index.js';
export { markupFreehandPlugin } from './freehand/index.js';
export { markupTextPlugin } from './text/index.js';

export type { MarkupCoreAPI, MarkupToolDefinition } from './core/api.js';
export type {
  MarkupTool,
  MarkupStyle,
  Annotation2D,
  Markup2DViewState,
  MarkupDraft,
  CommittedMarkupItem,
} from './types.js';

/** All markup plugins in install order (core first). Spread into the engine. */
export function markupPlugins(): DocumentPlugin[] {
  return [
    markupCorePlugin(),
    markupRectPlugin(),
    markupArrowPlugin(),
    markupCloudPlugin(),
    markupFreehandPlugin(),
    markupTextPlugin(),
  ];
}
