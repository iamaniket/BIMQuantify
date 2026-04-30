export type EffectsQuality = 'low' | 'medium' | 'high';

export interface EffectsOptions {
  /** Master switch. If false, the plugin is a no-op. */
  enabled?: boolean;
  /** Silhouette edge lines via Sobel post-process. */
  edges?: boolean;
  /** Tunes edge strength. */
  quality?: EffectsQuality;
}
