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
// NL_BOUNDS is intentionally NOT re-exported — it is an internal calibration
// constant (default for `createNlProjection`, and surfaced publicly only via
// `NL_PROJECTION_CONFIG.bounds`).
export {
  NL_VIEWBOX,
  NL_ASPECT_RATIO,
  NL_ASPECT_RATIO_CSS,
  NL_DEFAULT_ACCENT,
  createNlProjection,
} from './projection.js';
// Raw province silhouette geometry — exposed so non-DOM consumers (e.g. the
// React Native app, which renders with react-native-svg) can reuse the exact
// same path data the web `NetherlandsMap` draws, instead of copying it.
export { NL_PROVINCE_PATHS } from './data/nl-province-paths.js';

export const NL_PROJECTION_CONFIG: ProjectionConfig = {
  country: 'NL',
  viewBox: NL_VIEWBOX,
  bounds: NL_BOUNDS,
  createProjection: createNlProjection,
};
