import { Ionicons } from '@expo/vector-icons';
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from 'expo-router/drawer';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GridTexture } from '@/components/GridTexture';
import { useAuth } from '@/providers/AuthProvider';
import { colors, radii } from '@/theme';

const ICON = require('../../assets/images/icon.png');

type IconName = ComponentProps<typeof Ionicons>['name'];

const NAV: { key: string; label: string; icon: IconName; path: '/projects' | '/settings' }[] = [
  { key: 'projects', label: 'Projects', icon: 'folder-outline', path: '/projects' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', path: '/settings' },
];

/** Custom drawer content — the primary-coloured app sidebar with the brand grid. */
export function AppSidebar(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { me, activeMembership, switchOrganization, setTokens } = useAuth();
  const [switching, setSwitching] = useState<string | null>(null);

  const memberships = me?.memberships ?? [];
  const otherOrgs = memberships.filter((m) => m.organization_id !== me?.active_organization_id);

  function go(path: '/projects' | '/settings'): void {
    props.navigation.closeDrawer();
    router.navigate(path);
  }

  async function pickOrg(id: string): Promise<void> {
    setSwitching(id);
    try {
      await switchOrganization(id);
      props.navigation.closeDrawer();
    } catch {
      // Stay on the current org; the switch simply didn't take.
    } finally {
      setSwitching(null);
    }
  }

  return (
    <View style={styles.root}>
      <GridTexture step={22} />

      <DrawerContentScrollView {...props} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.brand}>
          <View style={styles.logoTile}>
            <Image source={ICON} style={styles.logoImg} contentFit="cover" />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.wordmark}>BimDossier</Text>
            <Text style={styles.tagline} numberOfLines={1}>
              Field snagging & BIM dossiers
            </Text>
          </View>
        </View>

        {activeMembership !== null ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Organization</Text>
            <Text style={styles.orgName} numberOfLines={1}>
              {activeMembership.organization_name}
            </Text>
            {otherOrgs.map((m) => (
              <Pressable
                key={m.organization_id}
                style={styles.orgSwitch}
                disabled={switching !== null}
                onPress={() => {
                  void pickOrg(m.organization_id);
                }}
              >
                <Ionicons name="swap-horizontal-outline" size={16} color="rgba(255,255,255,0.7)" />
                <Text style={styles.orgSwitchText} numberOfLines={1}>
                  {m.organization_name}
                </Text>
                {switching === m.organization_id ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.nav}>
          {NAV.map((item) => {
            const active = pathname.startsWith(item.path);
            return (
              <Pressable
                key={item.key}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => go(item.path)}
              >
                <Ionicons name={item.icon} size={20} color={colors.onPrimary} />
                <Text style={styles.navLabel}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </DrawerContentScrollView>

      <Pressable
        style={[styles.logout, { paddingBottom: insets.bottom + 14 }]}
        onPress={() => setTokens(null)}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.onPrimary} />
        <Text style={styles.navLabel}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 22 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  logoTile: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%' },
  brandText: { flex: 1 },
  wordmark: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, color: colors.onPrimary },
  tagline: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  section: { gap: 6 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
  },
  orgName: { fontSize: 16, fontWeight: '600', color: colors.onPrimary },
  orgSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  orgSwitchText: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  nav: { gap: 4 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radii.sm,
  },
  navItemActive: { backgroundColor: 'rgba(255,255,255,0.16)' },
  navLabel: { fontSize: 15, fontWeight: '600', color: colors.onPrimary },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
});
