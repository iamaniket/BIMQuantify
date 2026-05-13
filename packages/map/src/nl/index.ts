/**
 * NL jurisdiction map module — silhouette + WGS84-to-SVG projection.
 *
 * Re-exported from the package root for back-compat. New code should
 * either pin to the explicit name (e.g. `NetherlandsMap`) or — when
 * the project supports multiple countries — go through the parent
 * registry instead of importing this module directly.
 */

import { NL_BOUNDS, NL_VIEWBOX, createNlProjection } from './projection.js';
import type { ProjectionConfig } from '../core/types.js';

export { NetherlandsMap } from './NetherlandsMap.js';
export type { NetherlandsMapProps } from './NetherlandsMap.js';
export {
  NL_BOUNDS,
  NL_VIEWBOX,
  createNlProjection,
  projectToNlSvg,
} from './projection.js';

export const NL_PROJECTION_CONFIG: ProjectionConfig = {
  country: 'NL',
  viewBox: NL_VIEWBOX,
  bounds: NL_BOUNDS,
  createProjection: createNlProjection,
};
