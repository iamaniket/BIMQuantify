import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { Avatar } from '@/components/Avatar';
import { BlueGradient } from '@/components/BlueGradient';
import { useAuth } from '@/providers/AuthProvider';
import { colors, fonts } from '@/theme';

import type { LayoutKind } from './useLayoutKind';

interface Props {
  layout: LayoutKind;
  activeCount: number;
  archivedCount: number;
  /** Opens the navigation drawer (tapping the avatar / on phone the menu lives in the bottom nav). */
  onOpenDrawer: () => void;
}

const ON = 'rgba(255,255,255,0.92)';

/**
 * Blue gradient compact header (design `CompactHeader`): "Projects" + a
 * "N active · N archived" count, a notifications bell, and the user avatar.
 * Tablets get the fuller control cluster (EN + theme). The gradient bleeds under
 * the OS status bar via the top safe-area inset — no fake status bar is drawn.
 */
export function ProjectsHeader({ layout, activeCount, archivedCount, onOpenDrawer }: Props) {
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const full = layout !== 'phone';
  const titleSize = layout === 'phone' ? 21 : layout === 'tabletPortrait' ? 28 : 26;
  const hPad = layout === 'phone' ? 16 : layout === 'tabletPortrait' ? 34 : 30;
  const vPad = layout === 'phone' ? 11 : layout === 'tabletPortrait' ? 20 : 17;
  const pending = (me?.pending_invitations_count ?? 0) > 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BlueGradient />
      <View style={[styles.row, { paddingHorizontal: hPad, paddingTop: vPad, paddingBottom: vPad }]}>
        <View style={styles.titleWrap}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { fontSize: titleSize }]}
            numberOfLines={1}
          >
            {t('projects.header.title')}
          </Text>
          <Text style={styles.count} numberOfLines={1}>
            {t('projects.header.count', { active: activeCount, archived: archivedCount })}
          </Text>
        </View>

        <View style={[styles.controls, { gap: full ? 16 : 12 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('projects.header.notificationsA11y')}
            hitSlop={10}
            style={styles.iconBtn}
          >
            <Ionicons name="notifications-outline" size={20} color={ON} />
            {pending ? <View style={styles.bellDot} /> : null}
          </Pressable>

          {full ? <Text style={styles.lang}>{locale.toUpperCase()}</Text> : null}
          {full ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('projects.header.toggleThemeA11y')} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="sunny-outline" size={19} color={ON} />
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('projects.header.openMenuA11y')}
            hitSlop={8}
            onPress={onOpenDrawer}
          >
            <Avatar name={me?.user.full_name} email={me?.user.email} size={full ? 32 : 30} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.primary, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.displaySemibold, color: '#fff', letterSpacing: -0.4 },
  count: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  bellDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7fe0a8',
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  lang: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#fff' },
});
