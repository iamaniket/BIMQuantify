/**
 * 3D-viewer specialization of the generic {@link GenericPluginManager}. Kept
 * as a named class so `Viewer.ts` (and anything else) imports `PluginManager`
 * from here unchanged. All lifecycle logic lives in `./plugin.js`.
 */

import { PluginManager as GenericPluginManager } from './plugin.js';
import type { ViewerContext, ViewerEvents } from './types.js';

export class PluginManager extends GenericPluginManager<
  ViewerContext,
  ViewerEvents
> {}
