export type EffectsQuality = 'low' | 'medium' | 'high';

/**
 * Debug view modes for the edge shader.
 *   0 = normal output (default)
 *   1 = show normal buffer (RGB normals)
 *   2 = show edge mask only (white = edge, black = no edge)
 *   3 = edges off (pass-through color)
 */
export type EffectsDebugView = 0 | 1 | 2 | 3;

export interface EffectsOptions {
  /** Master switch. If false, the plugin is a no-op. */
  enabled?: boolean;
  /** Silhouette edge lines via Sobel post-process. */
  edges?: boolean;
  /** Tunes edge strength. */
  quality?: EffectsQuality;
  /** Debug view mode (0=normal, 1=normals, 2=edge mask, 3=no edges). */
  debugView?: EffectsDebugView;
}
