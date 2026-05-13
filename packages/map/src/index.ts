/**
 * Public surface of `@bimstitch/map`.
 *
 * NL is the only jurisdiction implemented today; types in `./types.js`
 * and `./core/types.js` are jurisdiction-agnostic and form the surface
 * a second country (DE/BE/FR…) would implement under `./<country>/`.
 */

export { NetherlandsMap } from './nl/NetherlandsMap.js';
export type { NetherlandsMapProps } from './nl/NetherlandsMap.js';
export {
  NL_BOUNDS,
  NL_VIEWBOX,
  createNlProjection,
  projectToNlSvg,
  NL_PROJECTION_CONFIG,
} from './nl/index.js';
export type { MapMarker, GeoBounds, ScreenPoint } from './types.js';
export type { ProjectionConfig } from './core/types.js';
