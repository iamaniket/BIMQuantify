/**
 * Public option shape for the effects plugin.
 */

export type EffectsQuality = 'low' | 'medium' | 'high';

export type GhostMode = 'off' | 'on-selection';

export interface EffectsOptions {
  /** Master switch. If false, the plugin is a no-op. */
  enabled?: boolean;
  /** Silhouette edge lines via Sobel post-process. */
  edges?: boolean;
  /** Scalable ambient occlusion (SAO). */
  ssao?: boolean;
  /** Bright outline around the current selection. */
  outline?: boolean;
  /** Ghost / x-ray non-selected items when something is selected. */
  ghost?: GhostMode;
  /** PBR room-environment for realistic glass/metal lighting. */
  environment?: boolean;
  /** Tunes SSAO sample count and outline thickness. */
  quality?: EffectsQuality;
}
