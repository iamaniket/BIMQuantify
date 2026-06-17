import { useWindowDimensions } from 'react-native';

export type LayoutKind = 'phone' | 'tabletPortrait' | 'tabletLandscape';

/**
 * Maps the live window size onto the three design artboards:
 *  - phone           → compact list cards + bottom nav (slide-in drawer)
 *  - tabletPortrait  → 2-col cover cards + stat strip + bottom nav (slide-in drawer)
 *  - tabletLandscape → 3-col cover cards + stat strip + docked sidebar (no bottom nav)
 *
 * Tablet threshold uses the SHORTER edge (>= 600dp) so orientation flips don't
 * reclassify the device; landscape is simply width > height.
 */
export function useLayoutKind(): LayoutKind {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  if (!isTablet) return 'phone';
  return width > height ? 'tabletLandscape' : 'tabletPortrait';
}
