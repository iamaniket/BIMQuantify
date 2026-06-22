import type { GeoBounds, ScreenPoint } from '../types.js';

/**
 * Geographic extents covered by the bundled NL silhouette. Calibrated so
 * the country fits the SVG viewBox precisely — see `nl-province-paths.json`
 * (extracted from netherlands.svg, viewBox `0 0 612.54211 723.61865`).
 *
 * If you swap the geometry, recompute these from the new bbox.
 */
export const NL_BOUNDS: GeoBounds = {
  minLng: 3.36,
  maxLng: 7.23,
  minLat: 50.75,
  maxLat: 53.55,
};

/** Native viewBox of the bundled SVG path data. */
export const NL_VIEWBOX = {
  width: 612.54211,
  height: 723.61865,
} as const;

/**
 * Aspect ratio (width ÷ height) of the bundled silhouette, derived from
 * {@link NL_VIEWBOX}. Exported so consumers size the map without re-hardcoding
 * the viewBox numbers — if the geometry is ever swapped, every caller updates
 * automatically. {@link NL_ASPECT_RATIO_CSS} is the same ratio formatted for a
 * CSS `aspect-ratio` value (and usable inside a `calc(... * (…))` width).
 */
export const NL_ASPECT_RATIO = NL_VIEWBOX.width / NL_VIEWBOX.height;
export const NL_ASPECT_RATIO_CSS = `${NL_VIEWBOX.width} / ${NL_VIEWBOX.height}`;

/**
 * Default marker accent — the brand primary blue. Single source of truth for
 * the dot/ring/pulse tint so non-DOM consumers (the react-native-svg port)
 * import this instead of re-declaring the literal.
 */
export const NL_DEFAULT_ACCENT = '#2c5697';

/**
 * Spherical-Mercator-style y for a given latitude (radians, then back to a
 * dimensionless value). Used so projected markers line up with the silhouette
 * — the SVG was traced from a Mercator-projected map.
 */
function mercatorY(latDeg: number): number {
  const lat = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

/**
 * Build a projection from WGS84 (lat, lng) to pixel coordinates inside a
 * width × height SVG canvas, preserving the bundled NL geometry's aspect
 * ratio.
 */
export function createNlProjection(
  width: number,
  height: number,
  bounds: GeoBounds = NL_BOUNDS,
): (lat: number, lng: number) => ScreenPoint {
  const { minLng, maxLng, minLat, maxLat } = bounds;
  const yTop = mercatorY(maxLat);
  const yBottom = mercatorY(minLat);
  const sx = width / (maxLng - minLng);
  const sy = height / (yTop - yBottom);
  return (lat: number, lng: number): ScreenPoint => {
    const x = (lng - minLng) * sx;
    const y = (yTop - mercatorY(lat)) * sy;
    return [x, y] as const;
  };
}
