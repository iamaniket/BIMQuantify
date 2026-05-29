export type EffectsQuality = 'low' | 'medium' | 'high';

export interface EffectsOptions {
  /** Master switch. If false, the plugin is a no-op. */
  enabled?: boolean;
  /** Tunes MSAA samples and FXAA strength. */
  quality?: EffectsQuality;
}
