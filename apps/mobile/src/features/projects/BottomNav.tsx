import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { colors } from '@/theme';

interface Props {
  /** Opens the navigation drawer (the left-most "Menu" item). */
  onMenu: () => void;
  menuOpen: boolean;
  /** Badge on the Projects tab. */
  projectsCount: number;
}

/**
 * Bottom navigation bar (design `BottomNav`): Menu on the LEFT opens the drawer,
 * Projects is the active tab. Sits above the home-indicator via the bottom inset;
 * each item is a full-height ≥44pt target. Rendered on phone + portrait tablet
 * only — landscape uses the docked sidebar.
 */
export function BottomNav({ onMenu, menuOpen, projectsCount }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <View style={styles.items}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('projects.nav.openMenuA11y')}
          accessibilityState={{ expanded: menuOpen }}
          style={styles.item}
          onPress={onMenu}
        >
          <Ionicons name="menu" size={22} color={menuOpen ? colors.primary : colors.textMuted} />
          <Text style={[styles.label, menuOpen ? styles.labelOn : null]}>{t('projects.nav.menu')}</Text>
        </Pressable>

        <View style={styles.item}>
          {/* Active tab — already on Projects, so it's a non-navigating indicator. */}
          <View accessibilityRole="tab" accessibilityState={{ selected: true }} style={styles.tabInner}>
            <View style={styles.indicator} />
            <View style={styles.iconWrap}>
              <Ionicons name="grid-outline" size={22} color={colors.primary} />
              {projectsCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{projectsCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, styles.labelOn]}>{t('projects.nav.projects')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  items: { flexDirection: 'row', height: 58 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabInner: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', flex: 1 },
  indicator: { position: 'absolute', top: 0, width: 26, height: 3, borderRadius: 999, backgroundColor: colors.primary },
  iconWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 8.5, fontWeight: '800' },
  label: { fontSize: 10, fontWeight: '500', color: colors.textMuted, marginTop: 4 },
  labelOn: { color: colors.primary, fontWeight: '700' },
});
