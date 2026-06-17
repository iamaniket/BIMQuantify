import { useId } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { gradients } from '@/theme';

export interface BlueGradientProps {
  /** Gradient stops, top-left -> bottom-right. Defaults to the brand blue. */
  colors?: readonly [string, string, string];
  style?: ViewStyle;
}

/**
 * The design's `BLUE_GRAD` rendered as an absolute-fill layer
 * (`linear-gradient(150deg, #3a63a6 0%, #2c5697 55%, #21437a 100%)`). Drop it
 * behind content in the Projects header, project cards, the drawer, and the FAB.
 * Uses `react-native-svg` (already a dependency — same approach as the login
 * hero in `features/auth/brandParts.tsx`), so no native module is added.
 *
 * Clip it by giving the PARENT `overflow: 'hidden'` + a `borderRadius`; the SVG
 * fills the parent and inherits its rounded corners. Ignores touches.
 */
export function BlueGradient({ colors = gradients.blue, style }: BlueGradientProps) {
  // Stable per-instance id so multiple gradients on screen don't collide. Strip
  // the colons React's useId emits — they're invalid inside an SVG url(#…) ref.
  const id = `blueGrad${useId().replace(/:/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          {/* ~150°: top-left -> bottom-right diagonal. */}
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="0.55" stopColor={colors[1]} />
            <Stop offset="1" stopColor={colors[2]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
