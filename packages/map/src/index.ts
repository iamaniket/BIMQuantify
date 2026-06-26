/**
 * Public surface of `@bimdossier/map`.
 *
 * NL is the only jurisdiction implemented today; types in `./types.js`
 * and `./core/types.js` are jurisdiction-agnostic and form the surface
 * a second country (DE/BE/FR…) would implement under `./<country>/`.
 */

// The NL jurisdiction barrel owns its full public surface (component, geometry,
// projection, aspect/accent constants, province paths, NL_PROJECTION_CONFIG).
// The root re-exports it wholesale rather than reaching into submodules.
export * from './nl/index.js';
// Jurisdiction-agnostic surface — the contract a second country would implement.
export type { MapMarker, GeoBounds, ScreenPoint } from './types.js';
export type { ProjectionConfig } from './core/types.js';
