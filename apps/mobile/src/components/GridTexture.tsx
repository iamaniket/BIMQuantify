import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';

export interface GridTextureProps {
  /** Cell size in px. Portal's HeroGrid uses 32; we default a little smaller. */
  step?: number;
  /** Line colour (alpha baked in). Matches HeroGrid's white-at-~10%. */
  color?: string;
  /** Line thickness. Defaults to the platform hairline. */
  lineWidth?: number;
  style?: ViewStyle;
}

/**
 * Blueprint square-grid texture, rendered in pure React Native so we don't pull
 * in react-native-svg (a native module that would force a dev-client rebuild).
 * Visually mirrors packages/brand/src/HeroGrid.tsx — a faint white grid over a
 * coloured surface. Drop it as an absolute layer behind content; it ignores
 * touches and clips itself to the measured box.
 */
export function GridTexture({
  step = 22,
  color = 'rgba(255,255,255,0.12)',
  lineWidth = StyleSheet.hairlineWidth,
  style,
}: GridTextureProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  };

  const cols = size.width > 0 ? Math.floor(size.width / step) : 0;
  const rows = size.height > 0 ? Math.floor(size.height / step) : 0;

  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, styles.clip, style]}
    >
      {Array.from({ length: cols + 1 }, (_, i) => (
        <View
          key={`v${i}`}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: i * step,
            width: lineWidth,
            backgroundColor: color,
          }}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <View
          key={`h${i}`}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: i * step,
            height: lineWidth,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
