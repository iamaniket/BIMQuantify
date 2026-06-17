import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { fonts } from '@/theme';

export interface BrandMarkProps {
  size?: number;
  text?: string;
  /** Tile background — defaults to the translucent-white chip on a blue surface. */
  bg?: string;
  /** Tile border. */
  bd?: string;
  fg?: string;
  style?: ViewStyle;
}

/**
 * The "BD" brand chip from the design's `Mark` — a rounded translucent tile with
 * the wordmark initials in Fraunces. Sits on the blue header and the drawer's
 * brand footer.
 */
export function BrandMark({
  size = 30,
  text = 'BD',
  bg = 'rgba(255,255,255,0.15)',
  bd = 'rgba(255,255,255,0.32)',
  fg = '#ffffff',
  style,
}: BrandMarkProps) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.24,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: bd,
        },
        styles.center,
        style,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={{ fontFamily: fonts.displaySemibold, color: fg, fontSize: size * 0.4, letterSpacing: 0.3 }}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
