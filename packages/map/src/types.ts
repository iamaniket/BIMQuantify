/** A single point of interest rendered on a {@link NetherlandsMap}. */
export interface MapMarker {
  /** WGS84 latitude in degrees. */
  readonly lat: number;
  /** WGS84 longitude in degrees. */
  readonly lng: number;
  /** Optional text label rendered next to the dot. */
  readonly label?: string;
  /** Optional count badge — e.g. number of projects at this city. */
  readonly count?: number;
  /** Override the marker dot/ring colour. Defaults to the brand primary. */
  readonly accent?: string;
}

/** Tuple of [x, y] pixel coordinates inside the map's SVG canvas. */
export type ScreenPoint = readonly [number, number];

/** Geographic bounding box covered by the bundled NL geometry. */
export interface GeoBounds {
  readonly minLng: number;
  readonly maxLng: number;
  readonly minLat: number;
  readonly maxLat: number;
}
