/**
 * Build a static PDOK aerial-photo thumbnail URL for a WGS84 coordinate.
 *
 * Uses PDOK Luchtfoto (Actueel_orthoHR) WMS — free, no auth, served by the
 * Dutch government. Returns a URL the browser fetches directly; nothing is
 * stored on our side.
 *
 * Service docs: https://www.pdok.nl/-/luchtfoto-pdok-services-vernieuwd
 */

const PDOK_AERIAL_WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';

const DEFAULT_LAT_HALF_SPAN = 0.0009; // ≈ 100 m N–S
const DEFAULT_LON_HALF_SPAN = 0.0017; // ≈ 110 m E–W at 52° N (matches 2:1 image)
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 400;

export type AerialThumbnailOptions = {
  width?: number;
  height?: number;
  /** Half-span in latitude degrees. Larger = wider view. */
  latHalfSpan?: number;
  /** Half-span in longitude degrees. Larger = wider view. */
  lonHalfSpan?: number;
};

export function pdokAerialThumbnailUrl(
  latitude: number,
  longitude: number,
  options: AerialThumbnailOptions = {},
): string {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const halfLat = options.latHalfSpan ?? DEFAULT_LAT_HALF_SPAN;
  const halfLon = options.lonHalfSpan ?? DEFAULT_LON_HALF_SPAN;

  const minLat = latitude - halfLat;
  const maxLat = latitude + halfLat;
  const minLon = longitude - halfLon;
  const maxLon = longitude + halfLon;

  // WMS 1.3.0 with a geographic CRS uses lat-first BBOX axis order.
  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    layers: 'Actueel_orthoHR',
    crs: 'EPSG:4326',
    bbox: `${String(minLat)},${String(minLon)},${String(maxLat)},${String(maxLon)}`,
    width: String(width),
    height: String(height),
    format: 'image/jpeg',
    styles: '',
  });
  return `${PDOK_AERIAL_WMS}?${params.toString()}`;
}

/** True when the coordinates fall within the rough Dutch mainland bounding box.
 * Used to gate the WMS thumbnail (PDOK only covers the Netherlands). */
export function isWithinNetherlands(latitude: number, longitude: number): boolean {
  return latitude >= 50.5 && latitude <= 53.8 && longitude >= 3.2 && longitude <= 7.3;
}
