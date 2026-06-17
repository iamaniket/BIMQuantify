import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { avatar as avatarTone } from '@/theme';

export interface AvatarProps {
  /** Full name; first letters of the first two words become the initials. */
  name?: string | null;
  /** Fallback when there's no name — first two letters of the local part. */
  email?: string | null;
  size?: number;
  bg?: string;
  fg?: string;
  style?: ViewStyle;
}

/** 1–2 letter initials from a name ("Sam Abuilder" -> "SA") or email local part. */
export function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name ?? '').trim();
  if (source.length > 0) {
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + second).toUpperCase() || first.toUpperCase();
  }
  const local = (email ?? '').split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase() || '?';
}

/** Gold initials avatar matching the design's `Avatar` (bg #e7c14e / fg #5a4410). */
export function Avatar({ name, email, size = 30, bg, fg, style }: AvatarProps) {
  const initials = initialsFrom(name, email);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg ?? avatarTone.bg,
        },
        styles.center,
        style,
      ]}
    >
      <Text
        allowFontScaling={false}
        style={{ color: fg ?? avatarTone.fg, fontSize: size * 0.38, fontWeight: '800', letterSpacing: 0.4 }}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
