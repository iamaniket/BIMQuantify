/**
 * Jurisdiction-agnostic map abstractions. NL is implemented under
 * `../nl/`; new countries plug in as sibling folders implementing this
 * surface.
 */

import type { GeoBounds, ScreenPoint } from '../types.js';

export interface ProjectionConfig {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Native SVG viewBox dimensions for the bundled silhouette. */
  viewBox: { width: number; height: number };
  /** Geographic extents the silhouette covers. */
  bounds: GeoBounds;
  /** Factory for a (lat, lng) → ScreenPoint function. */
  createProjection: (
    width: number,
    height: number,
    bounds?: GeoBounds,
  ) => (lat: number, lng: number) => ScreenPoint;
}
