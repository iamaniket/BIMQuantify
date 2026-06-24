import { Image, View, type ViewStyle } from 'react-native';

export interface BrandMarkProps {
  size?: number;
  style?: ViewStyle;
}

/**
 * The BimDossier brand logo — the full-colour "A"-folder mark, rendered at `size`.
 * One image for every surface (matches the web/portal `<BrandMark>`); sits on the
 * drawer's blue brand footer.
 */
export function BrandMark({ size = 30, style }: BrandMarkProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={require('../../assets/images/logo.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}
