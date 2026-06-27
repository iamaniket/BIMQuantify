import { Image, View, type ViewStyle } from 'react-native';

export type BrandMarkVariant = 'primary' | 'white';

export interface BrandMarkProps {
  size?: number;
  style?: ViewStyle;
  /**
   * `primary` (blue, for light surfaces) or `white` (for the primary-blue
   * drawer). Matches the web/portal `<BrandMark>` variant API.
   */
  variant?: BrandMarkVariant;
}

// The masters live in assets/logos/ and are copied here by scripts/sync-brand-assets.mjs.
// RN must `require()` a real bundled path, so we map each variant statically.
const SOURCES: Record<BrandMarkVariant, number> = {
  primary: require('../../assets/images/brand-primary.png'),
  white: require('../../assets/images/brand-white.png'),
};

/**
 * The BimDossier brand logo — the flat "A-house" mark, rendered at `size`.
 * One image for every surface (matches the web/portal `<BrandMark>`).
 */
export function BrandMark({ size = 30, style, variant = 'primary' }: BrandMarkProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={SOURCES[variant]}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}
